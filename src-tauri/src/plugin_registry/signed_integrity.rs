use super::*;

pub(super) fn read_metadata_file(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect signed metadata: {error}"))?;
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    };
    #[cfg(not(windows))]
    let linked = metadata.file_type().is_symlink();
    const MAX_METADATA_BYTES: u64 = 2 * 1024 * 1024;
    if linked || !metadata.is_file() || metadata.len() > MAX_METADATA_BYTES {
        return Err("Signed metadata must be a regular file no larger than 2 MiB".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|error| format!("Cannot open signed metadata: {error}"))?
        .take(MAX_METADATA_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read signed metadata: {error}"))?;
    if bytes.len() as u64 > MAX_METADATA_BYTES {
        return Err("Signed metadata exceeds 2 MiB".into());
    }
    Ok(bytes)
}

impl PluginRegistry {
    pub(super) fn verify_signed_installation(
        &self,
        plugin_id: &str,
        version: &str,
        root: &Path,
        metadata: &SignedInstallMetadata,
    ) -> Result<(), String> {
        if metadata.plugin_id != plugin_id
            || metadata.version != version
            || !publisher_is_trusted(
                &self.root,
                &metadata.publisher_key_id,
                &metadata.publisher_public_key,
            )
        {
            return Err("Signed package identity or publisher is unavailable".into());
        }
        let proof = metadata.integrity.as_ref().ok_or_else(||
            "Signed package integrity proof is missing; reinstall the original signed package (user data is preserved)".to_string())?;
        crate::plugin_package::verify_installed_package(
            root,
            proof,
            &metadata.publisher_key_id,
            &metadata.publisher_public_key,
        )
    }

    pub(crate) fn verify_current_integrity(&self, plugin_id: &str) -> Result<(), String> {
        let Some(plugin) = self.plugins.get(plugin_id) else {
            return Ok(());
        };
        if plugin.origin != PluginOrigin::Signed {
            return Ok(());
        }
        let root = plugin
            .package_root
            .as_ref()
            .ok_or_else(|| "Signed package path is unavailable".to_string())?;
        let metadata = self.read_signed_metadata(plugin_id)?;
        self.verify_signed_installation(plugin_id, &plugin.manifest.version, root, &metadata)
    }
}
