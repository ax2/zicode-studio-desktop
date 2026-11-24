//! Bounded, metadata-only filesystem input for a separate directory usage analyzer.
use super::*;
use serde::Serialize;

pub(super) const PROFILE: &str = "resource.local-directory.usage.draft1";
pub(super) const PERMISSION: &str = "resource.directory.usage.read";
pub(super) const PLUGIN: &str = "com.zicode.devtools.disk-inspector";
pub(super) const CAPABILITY: &str = "devtools.disk-inspector.scan";

pub(super) const MAX_DEPTH: usize = 16;
const MAX_RELATIVE_BYTES: usize = 2048;
const SCAN_TIME: Duration = Duration::from_secs(15);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Scan {
    schema_version: u32,
    profile: &'static str,
    pub(super) entries: Vec<Entry>,
    pub(super) visited_entries: usize,
    pub(super) skipped_links: usize,
    pub(super) skipped_depth: usize,
    pub(super) skipped_names: usize,
    pub(super) unreadable: usize,
    pub(super) limit_reason: Option<&'static str>,
    pub(super) partial: bool,
}

impl Default for Scan {
    fn default() -> Self {
        Self {
            schema_version: 1,
            profile: PROFILE,
            entries: Vec::new(),
            visited_entries: 0,
            skipped_links: 0,
            skipped_depth: 0,
            skipped_names: 0,
            unreadable: 0,
            limit_reason: None,
            partial: false,
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum Entry {
    File {
        path: String,
        #[serde(rename = "logicalBytes")]
        logical_bytes: String,
        #[serde(skip)]
        modified: Option<std::time::SystemTime>,
    },
    Directory {
        path: String,
    },
}

impl Entry {
    pub(super) fn path(&self) -> &str {
        match self {
            Self::File { path, .. } | Self::Directory { path } => path,
        }
    }
}

pub(super) struct Snapshot {
    pub(super) bytes: Vec<u8>,
    pub(super) entry_count: usize,
    pub(super) partial: bool,
}

pub(super) struct Limits {
    pub(super) entries: usize,
    pub(super) depth: usize,
    pub(super) deadline: Instant,
}

pub(super) fn snapshot(
    directory: &Dir,
    expected: &str,
    control: &Control,
    check_authority: impl Fn() -> Result<(), ApiError>,
) -> Result<Snapshot, ApiError> {
    scan(
        directory,
        expected,
        control,
        &check_authority,
        Limits {
            entries: MAX_ENTRIES,
            depth: MAX_DEPTH,
            deadline: Instant::now() + SCAN_TIME,
        },
    )
}

fn scan(
    directory: &Dir,
    expected: &str,
    control: &Control,
    check_authority: &impl Fn() -> Result<(), ApiError>,
    limits: Limits,
) -> Result<Snapshot, ApiError> {
    let report = inventory(directory, expected, control, check_authority, limits)?;
    let bytes =
        serde_json::to_vec(&report).map_err(|_| rejected("resource_directory_unavailable"))?;
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err(rejected("resource_directory_budget_exceeded"));
    }
    Ok(Snapshot {
        bytes,
        entry_count: report.entries.len(),
        partial: report.partial,
    })
}

pub(super) fn inventory(
    directory: &Dir,
    expected: &str,
    control: &Control,
    check_authority: &impl Fn() -> Result<(), ApiError>,
    limits: Limits,
) -> Result<Scan, ApiError> {
    control.check()?;
    if stamp(directory)? != expected {
        return Err(rejected("resource_directory_changed"));
    }
    let mut report = Scan::default();
    // Keep the serializer's fixed envelope outside the per-entry budget.
    let mut remaining = MAX_SNAPSHOT_BYTES - 1024;
    let mut pending = vec![(String::new(), 0)];
    'walk: while let Some((relative, depth)) = pending.pop() {
        control.check()?;
        if Instant::now() >= limits.deadline {
            report.limit_reason = Some("time");
            break;
        }
        let opened = match open_relative(directory, &relative) {
            Ok(opened) => opened,
            Err(error) if depth == 0 => return Err(error),
            Err(_) => {
                report.unreadable += 1;
                continue;
            }
        };
        let entries = match opened.entries() {
            Ok(entries) => entries,
            Err(_) if depth == 0 => return Err(rejected("resource_directory_unavailable")),
            Err(_) => {
                report.unreadable += 1;
                continue;
            }
        };
        for entry in entries {
            control.check()?;
            if Instant::now() >= limits.deadline {
                report.limit_reason = Some("time");
                break 'walk;
            }
            if report.visited_entries >= limits.entries {
                report.limit_reason = Some("entries");
                break 'walk;
            }
            if report.visited_entries % 128 == 0 {
                check_authority()?;
            }
            report.visited_entries += 1;
            let Ok(entry) = entry else {
                report.unreadable += 1;
                continue;
            };
            let Ok(name) = entry.file_name().into_string() else {
                report.skipped_names += 1;
                continue;
            };
            if !local_file::files::components(&name).is_ok_and(|parts| parts.len() == 1) {
                report.skipped_names += 1;
                continue;
            }
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            if path.len() > MAX_RELATIVE_BYTES {
                report.skipped_names += 1;
                continue;
            }
            let Ok(metadata) = opened.symlink_metadata(&name) else {
                report.unreadable += 1;
                continue;
            };
            if is_link(&metadata) {
                report.skipped_links += 1;
                continue;
            }
            let row = if metadata.is_file() {
                Entry::File {
                    path,
                    logical_bytes: metadata.len().to_string(),
                    modified: metadata.modified().ok().map(|time| time.into_std()),
                }
            } else if metadata.is_dir() {
                if depth >= limits.depth {
                    report.skipped_depth += 1;
                } else {
                    pending.push((path.clone(), depth + 1));
                }
                Entry::Directory { path }
            } else {
                report.unreadable += 1;
                continue;
            };
            let length = serde_json::to_vec(&row)
                .map_err(|_| rejected("resource_directory_unavailable"))?
                .len()
                + 1;
            let Some(new_remaining) = remaining.checked_sub(length) else {
                report.limit_reason = Some("snapshot_bytes");
                break 'walk;
            };
            remaining = new_remaining;
            report.entries.push(row);
        }
    }
    control.check()?;
    if stamp(directory)? != expected {
        return Err(rejected("resource_directory_changed"));
    }
    report
        .entries
        .sort_by(|left, right| left.path().cmp(right.path()));
    report.partial = report.limit_reason.is_some()
        || report.skipped_links + report.skipped_depth + report.skipped_names + report.unreadable
            > 0;
    Ok(report)
}

pub(super) fn open_relative(root: &Dir, path: &str) -> Result<Dir, ApiError> {
    let mut directory = root
        .try_clone()
        .map_err(|_| rejected("resource_directory_unavailable"))?;
    if !path.is_empty() {
        for part in path.split('/') {
            directory = open_checked_child(&directory, part)?;
        }
    }
    Ok(directory)
}

pub(super) fn is_link(metadata: &cap_std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use cap_std::fs::MetadataExt;
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn usage_uses_only_relative_metadata_and_marks_bounded_reads_partial() {
        let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        fs::create_dir_all(&scratch).unwrap();
        let root = tempfile::tempdir_in(scratch.canonicalize().unwrap()).unwrap();
        fs::create_dir_all(root.path().join("nested/deep")).unwrap();
        fs::write(root.path().join("nested/deep/thin"), b"secret bytes").unwrap();
        fs::write(root.path().join("root.txt"), b"xyz").unwrap();
        let directory = native_checksum::open_picked_directory(root.path()).unwrap();
        let identity = stamp(&directory).unwrap();
        let control = Control::new(Instant::now() + TTL);

        let complete = snapshot(&directory, &identity, &control, || Ok(())).unwrap();
        let value: Value = serde_json::from_slice(&complete.bytes).unwrap();
        assert!(!complete.partial);
        assert_eq!(
            value["entries"],
            json!([
                {"kind":"directory","path":"nested"},
                {"kind":"directory","path":"nested/deep"},
                {"kind":"file","path":"nested/deep/thin","logicalBytes":"12"},
                {"kind":"file","path":"root.txt","logicalBytes":"3"}
            ])
        );
        assert!(!value.to_string().contains("secret bytes"));
        assert!(!value.to_string().contains(root.path().to_str().unwrap()));

        let inspect = |entries, depth, deadline| {
            let partial = scan(
                &directory,
                &identity,
                &control,
                &|| Ok(()),
                Limits {
                    entries,
                    depth,
                    deadline,
                },
            )
            .unwrap();
            assert!(partial.partial);
            serde_json::from_slice::<Value>(&partial.bytes).unwrap()
        };
        let deadline = Instant::now() + SCAN_TIME;
        assert_eq!(inspect(1, MAX_DEPTH, deadline)["limitReason"], "entries");
        assert_eq!(inspect(MAX_ENTRIES, 0, deadline)["skippedDepth"], 1);
        assert_eq!(
            inspect(MAX_ENTRIES, MAX_DEPTH, Instant::now())["limitReason"],
            "time"
        );
        let interrupted = snapshot(&directory, &identity, &control, || {
            control.cancel();
            Ok(())
        });
        assert_eq!(
            interrupted.err().unwrap().1 .0["error"]["code"],
            "resource_directory_cancelled"
        );
    }
}
