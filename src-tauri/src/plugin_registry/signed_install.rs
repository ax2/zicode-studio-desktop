//! Extract verified signed packages without holding the live registry lock.
use super::*;

pub(crate) struct PreparedSignedInstall {
    pub(super) managed_root: PathBuf,
    pub(super) verified: VerifiedPackage,
    pub(super) staging: PathBuf,
}

impl PreparedSignedInstall {
    pub(crate) fn prepare(managed_root: &Path, verified: VerifiedPackage) -> Result<Self, String> {
        let staging =
            managed_root.join(format!(".signed-staging-{}", uuid::Uuid::new_v4().simple()));
        let prepared = Self {
            managed_root: managed_root.to_path_buf(),
            verified,
            staging,
        };
        extract_verified_package(&prepared.verified, &prepared.staging)?;
        let extracted = load_manifest(&prepared.staging)?;
        if extracted != prepared.verified.manifest {
            return Err("Signed plugin changed while it was being extracted".into());
        }
        Ok(prepared)
    }
}

impl Drop for PreparedSignedInstall {
    fn drop(&mut self) {
        if self.staging.exists() {
            if let Err(error) = fs::remove_dir_all(&self.staging) {
                log::warn!(
                    "[zicode-plugins] could not remove signed staging {}: {error}",
                    self.staging.display()
                );
            }
        }
    }
}
