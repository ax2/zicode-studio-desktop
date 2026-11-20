use super::Result;
use zeroize::Zeroizing;

pub(super) const SERVICE: &str = "ZiCode Studio Notes Sync";

pub(super) trait Secrets {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>>;
    fn set(&self, account: &str, value: &str) -> Result<()>;
    fn delete(&self, account: &str) -> Result<()>;
}

pub(super) struct SystemSecrets;
impl Secrets for SystemSecrets {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>> {
        match keyring::Entry::new(SERVICE, account).and_then(|entry| entry.get_password()) {
            Ok(value) => Ok(Some(Zeroizing::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("notes_sync_credentials_unavailable"),
        }
    }
    fn set(&self, account: &str, value: &str) -> Result<()> {
        keyring::Entry::new(SERVICE, account)
            .and_then(|entry| entry.set_password(value))
            .map_err(|_| "notes_sync_credentials_unavailable")
    }
    fn delete(&self, account: &str) -> Result<()> {
        match keyring::Entry::new(SERVICE, account).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("notes_sync_credentials_unavailable"),
        }
    }
}
