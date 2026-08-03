#![cfg_attr(not(test), allow(dead_code))]

use crate::metadata_store::{MetadataStore, PairedDeviceRecord};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const PAIRING_LIFETIME_SECONDS: u64 = 5 * 60;
const PAIRING_FAILURE_WINDOW_SECONDS: u64 = 60;
const MAX_PAIRING_FAILURES_PER_WINDOW: usize = 8;
const MAX_DEVICE_ID_LENGTH: usize = 128;
const MAX_DEVICE_NAME_LENGTH: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pairing {
    pub token: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PairingError {
    InvalidOrUsed,
    Expired,
    InvalidDevice,
    RateLimited { retry_after_seconds: u64 },
    Storage(String),
}

pub struct RemoteAuth {
    store: Arc<Mutex<MetadataStore>>,
    pending: HashMap<Vec<u8>, u64>,
    exchange_failures: HashMap<IpAddr, VecDeque<u64>>,
}

impl RemoteAuth {
    pub fn new(store: Arc<Mutex<MetadataStore>>) -> Self {
        Self {
            store,
            pending: HashMap::new(),
            exchange_failures: HashMap::new(),
        }
    }

    /// Resolve (or mint) the stable workspace id for a project path. Shares the
    /// same metadata store that native windows use, so LAN/mobile clients get
    /// the identical workspace id and can reuse any live runtime instead of
    /// spawning a duplicate for the same session file.
    pub fn resolve_workspace(&self, path: &Path) -> Result<String, String> {
        self.store
            .lock()
            .map_err(|_| "metadata store poisoned".to_string())?
            .workspace_id_for_path(path)
    }

    pub fn create_pairing(&mut self, now: u64) -> Pairing {
        self.pending.retain(|_, expires_at| *expires_at > now);
        let token = format!("picot_pair_{}", Uuid::new_v4().simple());
        let expires_at = now + PAIRING_LIFETIME_SECONDS;
        self.pending.insert(hash(&token), expires_at);
        Pairing { token, expires_at }
    }

    pub fn exchange(
        &mut self,
        pairing_token: &str,
        device_id: &str,
        device_name: &str,
        now: u64,
    ) -> Result<String, PairingError> {
        let device_id = validate_device_id(device_id)?;
        let device_name = normalize_device_name(device_name);
        let token_hash = hash(pairing_token);
        let expires_at = self
            .pending
            .remove(&token_hash)
            .ok_or(PairingError::InvalidOrUsed)?;
        if now > expires_at {
            return Err(PairingError::Expired);
        }
        let device_token = format!(
            "picot_device_{}{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        );
        self.store
            .lock()
            .map_err(|_| PairingError::Storage("metadata store poisoned".into()))?
            .store_device_token(device_id, &device_name, &device_token)
            .map_err(PairingError::Storage)?;
        Ok(device_token)
    }

    pub fn exchange_from(
        &mut self,
        peer_ip: IpAddr,
        pairing_token: &str,
        device_id: &str,
        device_name: &str,
        now: u64,
    ) -> Result<String, PairingError> {
        if let Some(retry_after_seconds) = self.retry_after(peer_ip, now) {
            return Err(PairingError::RateLimited {
                retry_after_seconds,
            });
        }
        match self.exchange(pairing_token, device_id, device_name, now) {
            Ok(token) => {
                self.exchange_failures.remove(&peer_ip);
                Ok(token)
            }
            Err(error @ (PairingError::InvalidOrUsed | PairingError::Expired)) => {
                self.exchange_failures
                    .entry(peer_ip)
                    .or_default()
                    .push_back(now);
                Err(error)
            }
            Err(error) => Err(error),
        }
    }

    fn retry_after(&mut self, peer_ip: IpAddr, now: u64) -> Option<u64> {
        let failures = self.exchange_failures.get_mut(&peer_ip)?;
        while failures
            .front()
            .is_some_and(|attempt| now.saturating_sub(*attempt) >= PAIRING_FAILURE_WINDOW_SECONDS)
        {
            failures.pop_front();
        }
        if failures.len() < MAX_PAIRING_FAILURES_PER_WINDOW {
            return None;
        }
        failures
            .front()
            .map(|first| PAIRING_FAILURE_WINDOW_SECONDS.saturating_sub(now.saturating_sub(*first)))
    }

    pub fn authorize(&mut self, device_token: &str) -> Result<bool, String> {
        self.store
            .lock()
            .map_err(|_| "metadata store poisoned".to_string())?
            .verify_device_token(device_token)
    }

    pub fn revoke(&mut self, device_id: &str) -> Result<(), String> {
        self.store
            .lock()
            .map_err(|_| "metadata store poisoned".to_string())?
            .revoke_device(device_id)
    }

    pub fn list_devices(&self) -> Result<Vec<PairedDeviceRecord>, String> {
        self.store
            .lock()
            .map_err(|_| "metadata store poisoned".to_string())?
            .list_paired_devices()
    }
}

fn validate_device_id(device_id: &str) -> Result<&str, PairingError> {
    let device_id = device_id.trim();
    if device_id.is_empty()
        || device_id.len() > MAX_DEVICE_ID_LENGTH
        || !device_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(PairingError::InvalidDevice);
    }
    Ok(device_id)
}

fn normalize_device_name(device_name: &str) -> String {
    let normalized = device_name.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return "Mobile device".to_string();
    }
    normalized.chars().take(MAX_DEVICE_NAME_LENGTH).collect()
}

fn hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

#[cfg(test)]
mod tests {
    use super::{PairingError, RemoteAuth};
    use crate::metadata_store::MetadataStore;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn auth() -> (RemoteAuth, std::path::PathBuf) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-remote-auth-{nonce}"));
        fs::create_dir_all(&temp).unwrap();
        let store = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        (RemoteAuth::new(Arc::new(Mutex::new(store))), temp)
    }

    #[test]
    fn exchanges_a_five_minute_single_use_pairing_token_for_a_device_token() {
        let (mut auth, temp) = auth();
        let pairing = auth.create_pairing(1_000);
        assert_eq!(pairing.expires_at, 1_300);

        let device_token = auth
            .exchange(&pairing.token, "phone", "Alice's phone", 1_001)
            .unwrap();
        assert!(auth.authorize(&device_token).unwrap());
        assert_eq!(
            auth.exchange(&pairing.token, "second-phone", "Second phone", 1_002),
            Err(PairingError::InvalidOrUsed)
        );
        assert!(
            !String::from_utf8_lossy(&fs::read(temp.join("picot.sqlite3")).unwrap())
                .contains(&device_token)
        );
        drop(auth);
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn rejects_expired_pairing_tokens_and_supports_device_revocation() {
        let (mut auth, temp) = auth();
        let expired = auth.create_pairing(2_000);
        assert_eq!(
            auth.exchange(&expired.token, "phone", "Phone", 2_301),
            Err(PairingError::Expired)
        );

        let pairing = auth.create_pairing(3_000);
        let token = auth
            .exchange(&pairing.token, "phone", "Phone", 3_001)
            .unwrap();
        let devices = auth.list_devices().unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_name, "Phone");
        auth.revoke("phone").unwrap();
        assert!(!auth.authorize(&token).unwrap());
        assert!(auth.list_devices().unwrap()[0].revoked_at.is_some());
        drop(auth);
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn rate_limits_repeated_invalid_pairing_exchanges_by_peer() {
        let (mut auth, temp) = auth();
        let peer = "192.168.1.20".parse().unwrap();
        for attempt in 0..8 {
            assert_eq!(
                auth.exchange_from(peer, "invalid", "phone", "Phone", 4_000 + attempt),
                Err(PairingError::InvalidOrUsed)
            );
        }
        assert_eq!(
            auth.exchange_from(peer, "invalid", "phone", "Phone", 4_008),
            Err(PairingError::RateLimited {
                retry_after_seconds: 52
            })
        );
        assert_eq!(
            auth.exchange_from(peer, "invalid", "phone", "Phone", 4_060),
            Err(PairingError::InvalidOrUsed)
        );
        drop(auth);
        fs::remove_dir_all(temp).unwrap();
    }
}
