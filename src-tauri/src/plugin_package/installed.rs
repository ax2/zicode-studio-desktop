use super::*;

fn regular_metadata(path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect signed package content: {error}"))?;
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let linked = metadata.file_type().is_symlink();
    if linked {
        return Err("Signed package content must not contain links".into());
    }
    Ok(metadata)
}

/// Revalidate the publisher's signed file list against the installed tree.
/// The proof lives in Host metadata, outside the immutable package directory.
pub(crate) fn verify_installed_package(
    root: &Path,
    proof: &serde_json::Value,
    expected_key_id: &str,
    expected_public_key: &str,
) -> Result<(), String> {
    let signed: SignedPackageManifest = serde_json::from_value(proof.clone())
        .map_err(|_| "Signed package integrity proof is invalid".to_string())?;
    if signed.schema_version != PACKAGE_SCHEMA_VERSION
        || signed.files.is_empty()
        || signed.files.len() > MAX_FILES
        || signed.publisher.key_id != expected_key_id
        || signed.publisher.public_key != expected_public_key
    {
        return Err("Signed package integrity identity is invalid".into());
    }
    validate_publisher(&signed.publisher)?;
    verify_signature(&signed)?;
    let mut expected_files = HashSet::new();
    let mut expected_directories = HashSet::new();
    let mut expanded = 0u64;
    for entry in &signed.files {
        validate_package_path(&entry.path)?;
        if entry.path.eq_ignore_ascii_case("package.json")
            || !expected_files.insert(entry.path.to_ascii_lowercase())
            || entry.size > MAX_FILE_BYTES
            || !is_hex_sha256(&entry.sha256)
        {
            return Err("Signed package integrity file list is invalid".into());
        }
        expanded = expanded
            .checked_add(entry.size)
            .ok_or_else(|| "Signed package integrity size overflow".to_string())?;
        if expanded > MAX_EXPANDED_BYTES {
            return Err("Signed package integrity content exceeds size limit".into());
        }
        for parent in Path::new(&entry.path).ancestors().skip(1) {
            if parent.as_os_str().is_empty() {
                break;
            }
            expected_directories.insert(
                parent
                    .to_string_lossy()
                    .replace('\\', "/")
                    .to_ascii_lowercase(),
            );
        }
    }
    if !expected_files.contains("plugin.json") || !regular_metadata(root)?.is_dir() {
        return Err("Signed package integrity root or manifest is invalid".into());
    }
    let mut seen = HashSet::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory)
            .map_err(|error| format!("Cannot inspect signed directory: {error}"))?
        {
            let path = entry
                .map_err(|error| format!("Cannot inspect signed entry: {error}"))?
                .path();
            let metadata = regular_metadata(&path)?;
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "Signed package integrity path escapes root".to_string())?
                .to_string_lossy()
                .replace('\\', "/")
                .to_ascii_lowercase();
            if metadata.is_dir() && expected_directories.contains(&relative) {
                pending.push(path);
            } else if metadata.is_file()
                && expected_files.contains(&relative)
                && seen.insert(relative)
            {
                // Size/digest are checked below after every path component was inspected.
            } else {
                return Err("Signed package integrity tree contains unexpected content".into());
            }
        }
    }
    if seen != expected_files {
        return Err("Signed package integrity tree is missing declared files".into());
    }
    for entry in &signed.files {
        let path = root.join(&entry.path);
        let metadata = regular_metadata(&path)?;
        if !metadata.is_file() || metadata.len() != entry.size {
            return Err(format!(
                "Signed package integrity size mismatch: {}",
                entry.path
            ));
        }
        let mut bytes = Vec::new();
        File::open(&path)
            .map_err(|error| format!("Cannot open signed file: {error}"))?
            .take(entry.size + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("Cannot read signed file: {error}"))?;
        if bytes.len() as u64 != entry.size || hex_sha256(&bytes) != entry.sha256 {
            return Err(format!(
                "Signed package integrity hash mismatch: {}",
                entry.path
            ));
        }
    }
    Ok(())
}
