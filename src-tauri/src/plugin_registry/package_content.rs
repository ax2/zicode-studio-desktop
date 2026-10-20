//! Content identity for managed developer plugins. Signed packages use their signed integrity proof.
use super::*;
use sha2::{Digest, Sha256};
use std::io::Read;

pub(super) fn signed_proof_digest(proof: &Value) -> Result<[u8; 32], String> {
    let bytes = serde_json::to_vec(proof)
        .map_err(|error| format!("Cannot encode signed plugin integrity proof: {error}"))?;
    Ok(Sha256::digest(bytes).into())
}

pub(super) fn digest(root: &Path) -> Result<[u8; 32], String> {
    let metadata = fs::symlink_metadata(root)
        .map_err(|error| format!("Cannot inspect developer plugin package: {error}"))?;
    if !metadata.is_dir() || linked(&metadata) {
        return Err("Developer plugin package root must be an ordinary directory".into());
    }
    let mut hash = Sha256::new();
    let mut pending = vec![(root.to_path_buf(), String::new())];
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    while let Some((directory, prefix)) = pending.pop() {
        let mut entries = fs::read_dir(&directory)
            .map_err(|error| format!("Cannot read developer plugin package: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot read developer plugin entry: {error}"))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "Developer plugin paths must use Unicode names".to_string())?;
            let relative = format!("{prefix}{name}");
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|error| format!("Cannot inspect developer plugin entry: {error}"))?;
            if linked(&metadata) {
                return Err(format!(
                    "Developer plugin packages cannot contain links: {relative}"
                ));
            }
            hash.update((relative.len() as u64).to_le_bytes());
            hash.update(relative.as_bytes());
            if metadata.is_dir() {
                hash.update(b"directory");
                pending.push((entry.path(), format!("{relative}/")));
                continue;
            }
            if !metadata.is_file() {
                return Err(
                    "Developer plugin packages can contain only files and directories".into(),
                );
            }
            file_count += 1;
            total_bytes = total_bytes.saturating_add(metadata.len());
            if file_count > MAX_PACKAGE_FILES
                || metadata.len() > MAX_PACKAGE_FILE_BYTES
                || total_bytes > MAX_PACKAGE_BYTES
            {
                return Err(
                    "Developer plugin package exceeds the allowed file or size limits".into(),
                );
            }
            let mut bytes = Vec::new();
            fs::File::open(entry.path())
                .map_err(|error| format!("Cannot open developer plugin file: {error}"))?
                .take(MAX_PACKAGE_FILE_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| format!("Cannot read developer plugin file: {error}"))?;
            if bytes.len() as u64 != metadata.len() {
                return Err("Developer plugin file changed while being inspected".into());
            }
            hash.update(b"file");
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(&bytes);
        }
    }
    Ok(hash.finalize().into())
}

pub(super) fn linked(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
