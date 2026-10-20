//! Prepare untrusted developer packages without holding the live registry lock.
use super::*;

pub(crate) struct PreparedDeveloperInstall {
    pub(super) managed_root: PathBuf,
    pub(super) manifest: PluginManifest,
    pub(super) staging: PathBuf,
}

impl PreparedDeveloperInstall {
    pub(crate) fn prepare(
        managed_root: &Path,
        source: &Path,
        expected_digest: Option<&str>,
    ) -> Result<Self, String> {
        if expected_digest.is_some_and(|digest| {
            digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err("Invalid developer plugin preview digest".into());
        }
        let source = PluginRegistry::canonical_developer_source_for(managed_root, source)?;
        let manifest = load_manifest(&source)?;
        let source_digest = digest_hex(&package_content::digest(&source)?);
        if expected_digest.is_some_and(|expected| !source_digest.eq_ignore_ascii_case(expected)) {
            return Err("Developer plugin changed after preview; select it again".into());
        }

        let staging = managed_root.join(format!(".staging-{}", uuid::Uuid::new_v4().simple()));
        let prepared = Self {
            managed_root: managed_root.to_path_buf(),
            manifest,
            staging,
        };
        copy_package_tree(&source, &prepared.staging)?;
        validate_staged_developer_manifest(&prepared.manifest, &prepared.staging)?;
        let staged_digest = digest_hex(&package_content::digest(&prepared.staging)?);
        if staged_digest != source_digest {
            return Err(
                "Developer plugin changed while it was being copied; select it again".into(),
            );
        }
        Ok(prepared)
    }
}

impl Drop for PreparedDeveloperInstall {
    fn drop(&mut self) {
        if self.staging.exists() {
            if let Err(error) = fs::remove_dir_all(&self.staging) {
                log::warn!(
                    "[zicode-plugins] could not remove developer staging {}: {error}",
                    self.staging.display()
                );
            }
        }
    }
}

#[derive(Debug)]
pub(crate) struct CommittedDeveloperInstall {
    pub(super) plugin_id: String,
    pub(super) backup: Option<PathBuf>,
}

impl CommittedDeveloperInstall {
    pub(crate) fn plugin_id(&self) -> &str {
        &self.plugin_id
    }
}

impl Drop for CommittedDeveloperInstall {
    fn drop(&mut self) {
        if let Some(backup) = &self.backup {
            if let Err(error) = fs::remove_dir_all(backup) {
                log::warn!(
                    "[zicode-plugins] installed {} but could not remove backup {}: {error}",
                    self.plugin_id,
                    backup.display()
                );
            }
        }
    }
}
