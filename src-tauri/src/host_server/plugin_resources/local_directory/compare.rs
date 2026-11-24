//! Bounded path-paired snapshot from two explicitly approved local directories.
use super::{checksum, usage, *};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsStr,
    io::ErrorKind,
    time::SystemTime,
};

pub(super) const PROFILE: &str = "resource.local-directory.compare.draft1";
pub(super) const PERMISSION: &str = "resource.directory.compare.read";
pub(super) const PLUGIN: &str = "com.zicode.devtools.directory-compare";
pub(super) const CAPABILITY: &str = "devtools.directory-compare.scan";

const MAX_PAIRS: usize = 256;
const HASH_BYTES: u64 = 256 * 1024 * 1024;
const SNAPSHOT_BYTES: usize = 60 * 1024;
const SCAN_TIME: Duration = Duration::from_secs(20);

#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Item {
    Directory,
    File {
        logical_bytes: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sha256: Option<String>,
    },
}

impl From<&usage::Entry> for Item {
    fn from(value: &usage::Entry) -> Self {
        match value {
            usage::Entry::File { logical_bytes, .. } => Self::File {
                logical_bytes: logical_bytes.clone(),
                sha256: None,
            },
            usage::Entry::Directory { .. } => Self::Directory,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Row<'a> {
    path: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    left: Option<Item>,
    #[serde(skip_serializing_if = "Option::is_none")]
    right: Option<Item>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verification: Option<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report<'a> {
    schema_version: u32,
    profile: &'static str,
    coverage_complete: bool,
    partial: bool,
    limit_reasons: BTreeSet<&'static str>,
    rows: Vec<Row<'a>>,
}

pub(super) struct Source<'a> {
    pub(super) directory: &'a Dir,
    pub(super) identity: &'a str,
}

fn record_inventory_limits(result: &mut Report<'_>, inventory: &usage::Scan) {
    result.limit_reasons.extend(inventory.limit_reason);
    result.limit_reasons.extend(
        [
            (inventory.skipped_links != 0).then_some("links"),
            (inventory.skipped_depth != 0).then_some("depth"),
            (inventory.skipped_names != 0).then_some("names"),
            (inventory.unreadable != 0).then_some("read_error"),
        ]
        .into_iter()
        .flatten(),
    );
}

pub(super) fn snapshot(
    left: Source<'_>,
    right: Source<'_>,
    control: &Control,
    check_authority: &impl Fn() -> Result<(), ApiError>,
) -> Result<usage::Snapshot, ApiError> {
    let deadline = Instant::now() + SCAN_TIME;
    let scan = |source: &Source<'_>| {
        usage::inventory(
            source.directory,
            source.identity,
            control,
            check_authority,
            usage::Limits {
                entries: MAX_ENTRIES,
                depth: usage::MAX_DEPTH,
                deadline,
            },
        )
    };
    let left_inventory = scan(&left)?;
    let right_inventory = scan(&right)?;
    let mut report = Report {
        schema_version: 1,
        profile: PROFILE,
        coverage_complete: !left_inventory.partial && !right_inventory.partial,
        partial: false,
        limit_reasons: BTreeSet::new(),
        rows: Vec::new(),
    };
    record_inventory_limits(&mut report, &left_inventory);
    record_inventory_limits(&mut report, &right_inventory);
    let mut pairs = BTreeMap::<&str, [Option<&usage::Entry>; 2]>::new();
    for (side, inventory) in [&left_inventory, &right_inventory].into_iter().enumerate() {
        for item in &inventory.entries {
            pairs.entry(item.path()).or_default()[side] = Some(item);
        }
    }
    let mut bytes_left = HASH_BYTES;
    let mut encoded_left = SNAPSHOT_BYTES - 1024;
    let mut buffer = vec![0; 64 * 1024];
    let guard = checksum::DigestGuard {
        deadline,
        check_authority,
    };
    let mut absence = AbsenceCheck {
        remaining: MAX_ENTRIES,
        control,
        guard,
    };
    // Retain paths that can be compared even when the pair cap leaves the coverage incomplete.
    let has_both_sides = |entries: &[Option<&usage::Entry>; 2]| entries.iter().all(Option::is_some);
    let ordered = pairs
        .iter()
        .filter(|(_, entries)| has_both_sides(entries))
        .chain(pairs.iter().filter(|(_, entries)| !has_both_sides(entries)));
    for (&path, &[a, b]) in ordered {
        check_authority()?;
        if Instant::now() >= deadline {
            report.limit_reasons.insert("time");
            report.coverage_complete = false;
            break;
        }
        if report.rows.len() == MAX_PAIRS {
            report.limit_reasons.insert("pairs");
            report.coverage_complete = false;
            break;
        }
        let mut row = Row {
            path,
            left: a.map(Item::from),
            right: b.map(Item::from),
            verification: None,
        };
        let hash_pair = match (a.and_then(file_info), b.and_then(file_info)) {
            (Some((size, lhs_time)), Some((rhs_size, rhs_time))) if size == rhs_size => {
                Some((size, lhs_time, rhs_time))
            }
            _ => None,
        };
        // Reserve the hashes and any verification status before reading file contents.
        let encoded = serde_json::to_vec(&row)
            .map_err(|_| rejected("resource_directory_unavailable"))?
            .len()
            + if hash_pair.is_some() { 200 } else { 32 };
        let Some(remaining) = encoded_left.checked_sub(encoded) else {
            report.limit_reasons.insert("snapshot_bytes");
            report.coverage_complete = false;
            continue;
        };
        encoded_left = remaining;
        let roots = [left.directory, right.directory];
        if let Some((size, lhs_time, rhs_time)) = hash_pair {
            let desired = size.saturating_mul(2);
            if let Some(remaining) = bytes_left.checked_sub(desired) {
                bytes_left = remaining;
                for ((root, modified), item) in roots
                    .into_iter()
                    .zip([lhs_time, rhs_time])
                    .zip([&mut row.left, &mut row.right])
                {
                    let outcome = checksum::digest_at(
                        root,
                        path,
                        checksum::DigestExpectation::Inventory { size, modified },
                        control,
                        &mut buffer,
                        guard,
                    )?;
                    use checksum::DigestOutcome::*;
                    let (reason, verification) = match outcome {
                        Complete(value) => {
                            if let Some(Item::File { sha256, .. }) = item {
                                *sha256 = Some(value);
                            }
                            continue;
                        }
                        Changed => ("changed", Some("changed")),
                        Unreadable => ("read_error", Some("readError")),
                        TimeLimit => ("time", None),
                    };
                    report.limit_reasons.insert(reason);
                    row.verification = verification;
                    break;
                }
            } else {
                report.limit_reasons.insert("hash_bytes");
            }
        } else if report.coverage_complete || (a.is_some() && b.is_some()) {
            for (side, (root, entry)) in roots.into_iter().zip([a, b]).enumerate() {
                let observed =
                    |prefix: &str| pairs.get(prefix).is_some_and(|items| items[side].is_some());
                let (reason, verification) =
                    match verify_presence(root, path, entry, &mut absence, observed)? {
                        Presence::Stable => continue,
                        Presence::Changed => ("changed", Some("changed")),
                        Presence::Unreadable => ("read_error", Some("readError")),
                        Presence::Limited(reason) => {
                            report.coverage_complete = false;
                            (reason, None)
                        }
                    };
                report.limit_reasons.insert(reason);
                row.verification = verification;
                break;
            }
        }
        report.rows.push(row);
    }
    check_authority()?;
    for source in [left, right] {
        if stamp(source.directory)? != source.identity {
            return Err(rejected("resource_directory_changed"));
        }
    }
    report.partial = !report.coverage_complete || !report.limit_reasons.is_empty();
    let bytes =
        serde_json::to_vec(&report).map_err(|_| rejected("resource_directory_unavailable"))?;
    if bytes.len() > SNAPSHOT_BYTES {
        return Err(rejected("resource_directory_budget_exceeded"));
    }
    Ok(usage::Snapshot {
        bytes,
        entry_count: report.rows.len(),
        partial: report.partial,
    })
}

fn file_info(entry: &usage::Entry) -> Option<(u64, Option<SystemTime>)> {
    match entry {
        usage::Entry::File {
            logical_bytes,
            modified,
            ..
        } => Some((logical_bytes.parse().ok()?, *modified)),
        usage::Entry::Directory { .. } => None,
    }
}

enum Presence {
    Stable,
    Changed,
    Unreadable,
    Limited(&'static str),
}

struct AbsenceCheck<'a> {
    remaining: usize,
    control: &'a Control,
    guard: checksum::DigestGuard<'a>,
}

impl AbsenceCheck<'_> {
    // Windows can resolve a differently cased name. Verify its actual spelling
    // when inferring that an exact relative path exists on the other side.
    fn exact_name(&mut self, directory: &Dir, name: &str) -> Result<Presence, ApiError> {
        let Ok(entries) = directory.entries() else {
            return Ok(Presence::Unreadable);
        };
        for entry in entries {
            self.control.check()?;
            if Instant::now() >= self.guard.deadline {
                return Ok(Presence::Limited("time"));
            }
            if self.remaining == 0 {
                return Ok(Presence::Limited("entries"));
            }
            if self.remaining % 128 == 0 {
                (self.guard.check_authority)()?;
            }
            self.remaining -= 1;
            let Ok(entry) = entry else {
                return Ok(Presence::Unreadable);
            };
            if entry.file_name() == OsStr::new(name) {
                return Ok(Presence::Changed);
            }
        }
        Ok(Presence::Stable)
    }
}

fn verify_presence(
    root: &Dir,
    path: &str,
    expected: Option<&usage::Entry>,
    absence: &mut AbsenceCheck<'_>,
    observed_ancestor: impl Fn(&str) -> bool,
) -> Result<Presence, ApiError> {
    let Ok(mut folder) = root.try_clone() else {
        return Ok(Presence::Unreadable);
    };
    let mut names = path.split('/').peekable();
    let absent = || {
        if expected.is_none() {
            Presence::Stable
        } else {
            Presence::Changed
        }
    };
    let mut prefix_end = 0;
    while let Some(name) = names.next() {
        prefix_end += name.len();
        let meta = match folder.symlink_metadata(name) {
            Ok(meta) => meta,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(absent()),
            Err(_) => return Ok(Presence::Unreadable),
        };
        if expected.is_none() && !observed_ancestor(&path[..prefix_end]) {
            match absence.exact_name(&folder, name)? {
                Presence::Changed => {}
                other => return Ok(other),
            }
        }
        if usage::is_link(&meta) {
            return Ok(Presence::Changed);
        }
        if names.peek().is_some() {
            if !meta.is_dir() {
                return Ok(absent());
            }
            let Ok(opened) = open_checked_child(&folder, name) else {
                return Ok(Presence::Changed);
            };
            folder = opened;
            prefix_end += 1;
            continue;
        }
        let shape_matches = match expected {
            Some(usage::Entry::Directory { .. }) => meta.is_dir(),
            Some(entry) if meta.is_file() => file_info(entry).is_some_and(|(size, modified)| {
                meta.len() == size && meta.modified().ok().map(|time| time.into_std()) == modified
            }),
            _ => false,
        };
        return Ok(if shape_matches {
            Presence::Stable
        } else {
            Presence::Changed
        });
    }
    Ok(Presence::Unreadable)
}
