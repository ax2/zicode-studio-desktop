//! The Host reads only same-size candidates from a confirmed folder.
use super::{checksum, usage, *};
use serde::Serialize;
use std::collections::BTreeMap;

pub(super) const PROFILE: &str = "resource.local-directory.duplicates.draft1";
pub(super) const PERMISSION: &str = "resource.directory.duplicates.read";
pub(super) const PLUGIN: &str = "com.zicode.devtools.duplicate-files";
pub(super) const CAPABILITY: &str = "devtools.duplicate-files.scan";

const SCAN_TIME: Duration = Duration::from_secs(20);
const MAX_CANDIDATES: usize = 256;
const MAX_HASH_BYTES: u64 = 256 * 1024 * 1024;
const MAX_REPORT_BYTES: usize = 60 * 1024;

struct Budget {
    deadline: Instant,
    candidates: usize,
    hash_bytes: u64,
    report_bytes: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileHash {
    path: String,
    logical_bytes: String,
    sha256: String,
    #[serde(skip)]
    modified: Option<std::time::SystemTime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    schema_version: u32,
    profile: &'static str,
    files: Vec<FileHash>,
    visited_entries: usize,
    candidate_files: usize,
    hashed_files: usize,
    hashed_bytes: String,
    skipped_links: usize,
    skipped_depth: usize,
    skipped_names: usize,
    unreadable: usize,
    changed_files: usize,
    skipped_budget: usize,
    limit_reason: Option<&'static str>,
    partial: bool,
}

pub(super) fn snapshot(
    directory: &Dir,
    expected: &str,
    control: &Control,
    check_authority: impl Fn() -> Result<(), ApiError>,
) -> Result<usage::Snapshot, ApiError> {
    scan(
        directory,
        expected,
        control,
        &check_authority,
        Budget {
            deadline: Instant::now() + SCAN_TIME,
            candidates: MAX_CANDIDATES,
            hash_bytes: MAX_HASH_BYTES,
            report_bytes: MAX_REPORT_BYTES,
        },
    )
}

fn scan(
    directory: &Dir,
    expected: &str,
    control: &Control,
    check_authority: &impl Fn() -> Result<(), ApiError>,
    budget: Budget,
) -> Result<usage::Snapshot, ApiError> {
    let inventory = usage::inventory(
        directory,
        expected,
        control,
        check_authority,
        usage::Limits {
            entries: MAX_ENTRIES,
            depth: usage::MAX_DEPTH,
            deadline: budget.deadline,
        },
    )?;
    let mut by_size = BTreeMap::<u64, Vec<FileHash>>::new();
    let placeholder = "0".repeat(64);
    for entry in inventory.entries {
        if let usage::Entry::File {
            path,
            logical_bytes,
            modified,
        } = entry
        {
            let size = logical_bytes
                .parse::<u64>()
                .map_err(|_| rejected("resource_directory_unavailable"))?;
            by_size.entry(size).or_default().push(FileHash {
                path,
                logical_bytes,
                sha256: placeholder.clone(),
                modified,
            });
        }
    }
    by_size.retain(|_, paths| paths.len() > 1);
    let candidates = by_size.values().map(Vec::len).sum();
    let mut report = Report {
        schema_version: 1,
        profile: PROFILE,
        files: Vec::new(),
        visited_entries: inventory.visited_entries,
        candidate_files: candidates,
        hashed_files: 0,
        hashed_bytes: String::new(),
        skipped_links: inventory.skipped_links,
        skipped_depth: inventory.skipped_depth,
        skipped_names: inventory.skipped_names,
        unreadable: inventory.unreadable,
        changed_files: 0,
        skipped_budget: 0,
        limit_reason: inventory.limit_reason,
        partial: inventory.partial,
    };
    let mut remaining_count = budget.candidates;
    let mut remaining_bytes = budget.hash_bytes;
    // Reserve room for the fixed report fields. Reserve every path of a size
    // group before reading it, so bounds never select arbitrary matches.
    let mut remaining_report = budget.report_bytes.saturating_sub(1024);
    let mut accounted = 0;
    let mut hashed_bytes = 0;
    let mut buffer = vec![0; 64 * 1024];
    let guard = checksum::DigestGuard {
        deadline: budget.deadline,
        check_authority,
    };
    'groups: for (size, candidates) in by_size.into_iter().rev() {
        check_authority()?;
        if Instant::now() >= budget.deadline {
            report.limit_reason = Some("time");
            break;
        }
        let count = candidates.len();
        let length = size.saturating_mul(count as u64);
        if count > remaining_count {
            report.limit_reason.get_or_insert("candidate_files");
            continue;
        }
        if length > remaining_bytes {
            report.limit_reason.get_or_insert("hash_bytes");
            continue;
        }
        let encoded_length = serde_json::to_vec(&candidates)
            .map_err(|_| rejected("resource_directory_unavailable"))?
            .len();
        if encoded_length > remaining_report {
            report.limit_reason.get_or_insert("snapshot_bytes");
            continue;
        }
        remaining_count -= count;
        remaining_bytes -= length;
        remaining_report -= encoded_length;
        for mut candidate in candidates {
            let expected = checksum::DigestExpectation::Inventory {
                size,
                modified: candidate.modified,
            };
            match digest_at(
                directory,
                &candidate.path,
                expected,
                control,
                &mut buffer,
                guard,
            )? {
                checksum::DigestOutcome::Complete(digest) => {
                    candidate.sha256 = digest;
                    report.files.push(candidate);
                    hashed_bytes += size;
                }
                checksum::DigestOutcome::Unreadable => report.unreadable += 1,
                checksum::DigestOutcome::Changed => report.changed_files += 1,
                checksum::DigestOutcome::TimeLimit => {
                    report.limit_reason = Some("time");
                    break 'groups;
                }
            }
            accounted += 1;
        }
    }
    check_authority()?;
    control.check()?;
    if stamp(directory)? != expected {
        return Err(rejected("resource_directory_changed"));
    }
    report.hashed_files = report.files.len();
    report.hashed_bytes = hashed_bytes.to_string();
    report.skipped_budget = report.candidate_files - accounted;
    report.partial |= report.limit_reason.is_some()
        || report.changed_files + report.unreadable + report.skipped_budget > 0;
    let bytes =
        serde_json::to_vec(&report).map_err(|_| rejected("resource_directory_unavailable"))?;
    if bytes.len() > budget.report_bytes {
        return Err(rejected("resource_directory_budget_exceeded"));
    }
    Ok(usage::Snapshot {
        bytes,
        entry_count: report.hashed_files,
        partial: report.partial,
    })
}

fn digest_at(
    directory: &Dir,
    path: &str,
    expected: checksum::DigestExpectation<'_>,
    control: &Control,
    buffer: &mut [u8],
    guard: checksum::DigestGuard<'_>,
) -> Result<checksum::DigestOutcome, ApiError> {
    use checksum::DigestOutcome;
    let (parent, name) = path.rsplit_once('/').unwrap_or(("", path));
    let Ok(folder) = usage::open_relative(directory, parent) else {
        return Ok(DigestOutcome::Changed);
    };
    let Ok(before) = stamp(&folder) else {
        return Ok(DigestOutcome::Unreadable);
    };
    let result = checksum::read_digest(&folder, name, control, buffer, expected, Some(guard))?;
    if matches!(result, DigestOutcome::Complete(_)) {
        let current = usage::open_relative(directory, parent).and_then(|folder| stamp(&folder));
        if !current.is_ok_and(|stamp| stamp == before) {
            return Ok(DigestOutcome::Changed);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_only_same_size_candidates_and_keeps_relative_names() {
        let root = super::super::tests::Fixture::new();
        fs::create_dir(root.0.join("子目录")).unwrap();
        fs::write(root.0.join("a.txt"), b"abc").unwrap();
        fs::write(root.0.join("子目录/另一个.txt"), b"abc").unwrap();
        fs::write(root.0.join("b.txt"), b"xyz").unwrap();
        fs::write(
            root.0.join("unshared.txt"),
            b"never read these eleven bytes",
        )
        .unwrap();
        fs::write(root.0.join("empty"), b"").unwrap();
        fs::write(root.0.join("子目录/empty"), b"").unwrap();
        let dir = native_checksum::open_picked_directory(&root.0).unwrap();
        let identity = stamp(&dir).unwrap();
        let control = Control::new(Instant::now() + TTL);
        let result = snapshot(&dir, &identity, &control, || Ok(())).unwrap();
        let value: Value = serde_json::from_slice(&result.bytes).unwrap();
        assert_eq!(value["profile"], PROFILE);
        assert_eq!(value["candidateFiles"], 5);
        assert_eq!(value["hashedFiles"], 5);
        assert_eq!(value["hashedBytes"], "9");
        assert_eq!(value["skippedBudget"], 0);
        assert!(!result.partial);
        assert_eq!(value["files"][0]["path"], "a.txt");
        assert!(value["files"][0].get("modified").is_none());
        assert_eq!(value["files"][0]["sha256"], sha256_hex(b"abc"));
        assert_eq!(value["files"][1]["sha256"], sha256_hex(b"xyz"));
        assert_eq!(value["files"][2]["path"], "子目录/另一个.txt");
        assert_eq!(value["files"][2]["sha256"], sha256_hex(b"abc"));
        assert_eq!(value["files"][3]["sha256"], sha256_hex(b""));
        let text = String::from_utf8(result.bytes).unwrap();
        assert!(!text.contains("unshared.txt"));
        assert!(!text.contains("never read these"));
        drop(dir);
        fs::remove_file(root.0.join("子目录/另一个.txt")).unwrap();
        fs::remove_file(root.0.join("子目录/empty")).unwrap();
        fs::remove_dir(root.0.join("子目录")).unwrap();
        fs::remove_file(root.0.join("b.txt")).unwrap();
        fs::remove_file(root.0.join("unshared.txt")).unwrap();
        fs::remove_file(root.0.join("empty")).unwrap();
    }

    #[test]
    fn checks_the_inventoried_timestamp_and_rechecks_authority_mid_read() {
        use std::{cell::Cell, time::UNIX_EPOCH};
        let root = super::super::tests::Fixture::new();
        let path = root.0.join("a.txt");
        let file = fs::File::create(&path).unwrap();
        let size = 5 * 1024 * 1024;
        file.set_len(size).unwrap();
        file.set_modified(UNIX_EPOCH + Duration::from_secs(1_700_000_000))
            .unwrap();
        let original = file.metadata().unwrap().modified().unwrap();
        file.set_modified(UNIX_EPOCH + Duration::from_secs(1_710_000_000))
            .unwrap();
        let updated = file.metadata().unwrap().modified().unwrap();
        drop(file);
        let directory = native_checksum::open_picked_directory(&root.0).unwrap();
        let control = Control::new(Instant::now() + TTL).with_checksum_total(Some(1));
        let mut buffer = vec![0; 64 * 1024];
        let deadline = Instant::now() + SCAN_TIME;
        let allow = checksum::DigestGuard {
            deadline,
            check_authority: &|| Ok(()),
        };
        let old = checksum::DigestExpectation::Inventory {
            size,
            modified: Some(original),
        };
        assert!(matches!(
            digest_at(&directory, "a.txt", old, &control, &mut buffer, allow).unwrap(),
            checksum::DigestOutcome::Changed
        ));
        let reads = Cell::new(0);
        let authority = || {
            reads.set(reads.get() + 1);
            if reads.get() == 2 {
                return Err(rejected("resource_authorization_changed"));
            }
            Ok(())
        };
        let guard = checksum::DigestGuard {
            deadline,
            check_authority: &authority,
        };
        let current = checksum::DigestExpectation::Inventory {
            size,
            modified: Some(updated),
        };
        let result = digest_at(&directory, "a.txt", current, &control, &mut buffer, guard);
        assert_eq!(
            result.err().unwrap().1 .0["error"]["code"],
            "resource_authorization_changed"
        );
        assert_eq!(
            control.checksum_report("test").unwrap()["fileBytesRead"],
            4 * 1024 * 1024
        );
    }

    #[test]
    fn skips_entire_size_groups_at_limits_and_honors_cancel() {
        let root = super::super::tests::Fixture::new();
        fs::write(root.0.join("a.txt"), b"long").unwrap();
        fs::write(root.0.join("b.txt"), b"long").unwrap();
        fs::write(root.0.join("c.txt"), b"x").unwrap();
        fs::write(root.0.join("d.txt"), b"x").unwrap();
        let dir = native_checksum::open_picked_directory(&root.0).unwrap();
        let identity = stamp(&dir).unwrap();
        let control = Control::new(Instant::now() + TTL);
        let cases = [
            (3, 3, MAX_REPORT_BYTES, "hash_bytes", 2),
            (1, MAX_HASH_BYTES, MAX_REPORT_BYTES, "candidate_files", 0),
            (MAX_CANDIDATES, MAX_HASH_BYTES, 1100, "snapshot_bytes", 0),
        ];
        for (candidates, hash_bytes, report_bytes, limit, count) in cases {
            let result = scan(
                &dir,
                &identity,
                &control,
                &|| Ok(()),
                Budget {
                    deadline: Instant::now() + SCAN_TIME,
                    candidates,
                    hash_bytes,
                    report_bytes,
                },
            )
            .unwrap();
            let value: Value = serde_json::from_slice(&result.bytes).unwrap();
            assert!(result.partial);
            assert_eq!(value["hashedFiles"], count);
            assert_eq!(value["candidateFiles"], 4);
            assert_eq!(value["skippedBudget"], 4 - count);
            assert_eq!(value["limitReason"], limit);
        }
        let interrupted = snapshot(&dir, &identity, &control, || {
            control.cancel();
            Ok(())
        });
        assert_eq!(
            interrupted.err().unwrap().1 .0["error"]["code"],
            "resource_directory_cancelled"
        );
        drop(dir);
        for name in ["b.txt", "c.txt", "d.txt"] {
            fs::remove_file(root.0.join(name)).unwrap();
        }
    }
}
