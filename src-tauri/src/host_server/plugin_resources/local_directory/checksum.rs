//! SHA256SUMS review for names explicitly confirmed in one open directory.
use super::{local_file, rejected, ApiError, Control, Dir};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{OpenOptions, OpenOptionsExt};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::File;
use std::io::{self, Read};

pub(super) const PROFILE: &str = "resource.local-directory.checksum.preview1";
const MAX_MANIFEST_BYTES: usize = 32 * 1024;

pub(super) const GENERATE_PROFILE: &str = "resource.local-directory.checksum.generate.preview1";
pub(super) const MAX_FILES: usize = 64;

pub(super) fn safe_name(name: &str) -> bool {
    !(name.is_empty()
        || matches!(name, "." | "..")
        || name.ends_with(['.', ' '])
        || name.encode_utf16().count() > 255
        || crate::portable_path::reserved_windows_device_name(name)
        || name.chars().any(|ch| {
            ch.is_control() || matches!(ch, '/' | '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
        }))
}

pub(super) struct Entry {
    name: String,
    expected: String,
}

pub(super) fn parse(manifest: &str) -> Result<Vec<Entry>, ApiError> {
    let invalid = || rejected("resource_checksum_manifest_invalid");
    if manifest.len() > MAX_MANIFEST_BYTES {
        return Err(invalid());
    }
    let mut entries = Vec::new();
    let mut names = HashSet::new();
    for line in manifest.lines().filter(|line| !line.trim().is_empty()) {
        let (digest, name) = line.split_once("  ").ok_or_else(invalid)?;
        if digest.len() != 64
            || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
            || !safe_name(name)
            || !names.insert(name.to_lowercase())
            || entries.len() == MAX_FILES
        {
            return Err(invalid());
        }
        entries.push(Entry {
            name: name.to_owned(),
            expected: digest.to_ascii_lowercase(),
        });
    }
    if entries.is_empty() {
        return Err(invalid());
    }
    Ok(entries)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum Status {
    Match,
    Mismatch,
    Missing,
    ReadError,
}

#[derive(serde::Serialize)]
pub(super) struct Row<'a> {
    name: &'a str,
    expected: &'a str,
    actual: Option<String>,
    status: Status,
}

fn open_regular(directory: &Dir, name: &str) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(windows)]
    options.share_mode(windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ);
    #[cfg(unix)]
    options.custom_flags(libc::O_NONBLOCK);
    directory
        .open_with(name, &options)
        .map(cap_std::fs::File::into_std)
}

fn regular_metadata(metadata: &cap_std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use cap_std::fs::MetadataExt;
        if metadata.file_attributes()
            & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT
            != 0
        {
            return false;
        }
    }
    metadata.is_file()
}

fn digest_file(
    directory: &Dir,
    name: &str,
    control: &Control,
    buffer: &mut [u8],
    selected: Option<&(String, u64)>,
) -> Result<Option<String>, ApiError> {
    let Ok(mut file) = open_regular(directory, name) else {
        return Ok(None);
    };
    let Ok((before, length)) = local_file::files::regular_file_identity(&file) else {
        return Ok(None);
    };
    let expected = (before, length);
    if selected.is_some_and(|stamp| *stamp != expected) {
        return Ok(None);
    }
    let mut sha = Sha256::new();
    let mut bytes = 0;
    loop {
        control.check()?;
        let count = match file.read(buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Ok(None),
        };
        bytes += count as u64;
        if bytes > length {
            return Ok(None);
        }
        sha.update(&buffer[..count]);
    }
    let after = local_file::files::regular_file_identity(&file).ok();
    let reopened = open_regular(directory, name)
        .ok()
        .and_then(|file| local_file::files::regular_file_identity(&file).ok());
    if bytes != length || after.as_ref() != Some(&expected) || reopened.as_ref() != Some(&expected)
    {
        return Ok(None);
    }
    Ok(Some(format!("{:x}", sha.finalize())))
}

pub(super) fn verify<'a>(
    directory: &Dir,
    entries: &'a [Entry],
    control: &Control,
    check_authority: &impl Fn() -> Result<(), ApiError>,
) -> Result<Vec<Row<'a>>, ApiError> {
    let mut rows = Vec::with_capacity(entries.len());
    let mut buffer = vec![0; 64 * 1024];
    for entry in entries {
        check_authority()?;
        control.check()?;
        let (actual, status) = match directory.symlink_metadata(&entry.name) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => (None, Status::Missing),
            Ok(meta) if regular_metadata(&meta) => {
                let actual = digest_file(directory, &entry.name, control, &mut buffer, None)?;
                let status = match actual.as_deref() {
                    Some(digest) if digest == entry.expected => Status::Match,
                    Some(_) => Status::Mismatch,
                    None => Status::ReadError,
                };
                (actual, status)
            }
            _ => (None, Status::ReadError),
        };
        rows.push(Row {
            name: &entry.name,
            expected: &entry.expected,
            actual,
            status,
        });
    }
    control.check()?;
    Ok(rows)
}

pub(super) struct SelectedFile {
    name: String,
    identity: (String, u64),
}

#[derive(serde::Serialize)]
pub(super) struct FileDigest<'a> {
    name: &'a str,
    sha256: String,
}

pub(super) fn freeze_selection(
    directory: &Dir,
    names: &[String],
) -> Result<Vec<SelectedFile>, ApiError> {
    let mut unique = HashSet::new();
    if names.is_empty()
        || names.len() > MAX_FILES
        || names
            .iter()
            .any(|name| !safe_name(name) || !unique.insert(name.to_lowercase()))
        || names.iter().map(|name| name.len() + 67).sum::<usize>() > MAX_MANIFEST_BYTES
    {
        return Err(rejected("resource_checksum_manifest_invalid"));
    }
    let mut selected = Vec::with_capacity(names.len());
    for name in names {
        let unavailable = || rejected("resource_checksum_source_unavailable");
        if !directory
            .symlink_metadata(name)
            .is_ok_and(|meta| regular_metadata(&meta))
        {
            return Err(unavailable());
        }
        let handle = open_regular(directory, name).map_err(|_| unavailable())?;
        let identity = local_file::files::regular_file_identity(&handle)?;
        selected.push(SelectedFile {
            name: name.clone(),
            identity,
        });
    }
    Ok(selected)
}

pub(super) fn generate<'a>(
    directory: &Dir,
    files: &'a [SelectedFile],
    control: &Control,
    check_authority: &impl Fn() -> Result<(), ApiError>,
) -> Result<Vec<FileDigest<'a>>, ApiError> {
    let mut hashes = Vec::with_capacity(files.len());
    let mut buffer = vec![0; 64 * 1024];
    for file in files {
        check_authority()?;
        let sha256 = digest_file(
            directory,
            &file.name,
            control,
            &mut buffer,
            Some(&file.identity),
        )?
        .ok_or_else(|| rejected("resource_checksum_source_changed"))?;
        hashes.push(FileDigest {
            name: &file.name,
            sha256,
        });
    }
    control.check()?;
    Ok(hashes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_server::plugin_resources::local_directory::tests::Fixture;
    use std::time::{Duration, Instant};

    const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    #[test]
    fn checksum_manifest_rejects_unsafe_names_and_accepts_64() {
        let manifest = (0..64)
            .map(|i| format!("{ABC}  文件 {i}.txt\r\n"))
            .collect::<String>();
        assert_eq!(parse(&manifest).unwrap().len(), 64);
        assert!(parse(&format!("{manifest}{ABC}  extra.txt")).is_err());
        assert!(parse(&format!("{ABC}  AbC.txt\n{ABC}  abc.txt")).is_err());
        for name in [
            "",
            "..",
            "../sibling.txt",
            "file.txt:stream",
            "file.txt ",
            "NUL.txt",
            "LPT1",
            "a/b",
            "a\\b",
        ] {
            assert!(parse(&format!("{ABC}  {name}")).is_err(), "{name:?}");
        }
        assert!(parse(&" ".repeat(MAX_MANIFEST_BYTES + 1)).is_err());
    }

    #[test]
    fn checksum_folder_streams_actual_files_and_distinguishes_missing_and_unreadable() {
        let root = Fixture::new();
        std::fs::write(root.0.join("文件.txt"), b"abc").unwrap();
        std::fs::write(root.0.join("different.txt"), b"different").unwrap();
        std::fs::create_dir(root.0.join("directory.txt")).unwrap();
        let large = vec![42; 180_000];
        let digest = format!("{:x}", Sha256::digest(&large));
        std::fs::write(root.0.join("large.bin"), large).unwrap();
        let manifest = format!("{ABC}  文件.txt\r\n{ABC}  different.txt\n{ABC}  missing.txt\n{ABC}  directory.txt\n{digest}  large.bin");
        let entries = parse(&manifest).unwrap();
        let directory = Dir::open_ambient_dir(&root.0, cap_std::ambient_authority()).unwrap();
        let control = Control::new(Instant::now() + Duration::from_secs(15));
        let rows = verify(&directory, &entries, &control, &|| Ok(())).unwrap();
        assert_eq!(rows[0].actual.as_deref(), Some(ABC));
        assert!(matches!(rows[0].status, Status::Match));
        assert!(matches!(rows[1].status, Status::Mismatch));
        assert!(matches!(rows[2].status, Status::Missing) && rows[2].actual.is_none());
        assert!(matches!(rows[3].status, Status::ReadError) && rows[3].actual.is_none());
        assert_eq!(rows[4].actual.as_deref(), Some(digest.as_str()));
        assert!(control.cancel());
        assert!(verify(&directory, &entries, &control, &|| Ok(())).is_err());
    }
}
