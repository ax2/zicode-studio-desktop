use super::{SyncError, MAX_OBJECT_BYTES};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    XChaCha20Poly1305, XNonce,
};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8] = b"ZNS1";

// No Debug/Serialize implementation: this is never application status data.
pub struct SyncKey(XChaCha20Poly1305);

impl SyncKey {
    pub fn generate() -> (Self, String) {
        let mut key = XChaCha20Poly1305::generate_key(&mut OsRng);
        let recovery = format!("ZNS1-{}", URL_SAFE_NO_PAD.encode(key.as_slice()));
        let cipher = Self(XChaCha20Poly1305::new(&key));
        key.as_mut_slice().zeroize();
        (cipher, recovery)
    }

    pub fn from_recovery(recovery: &str) -> Result<Self, SyncError> {
        let bytes = Zeroizing::new(
            URL_SAFE_NO_PAD
                .decode(
                    recovery
                        .strip_prefix("ZNS1-")
                        .ok_or(SyncError::InvalidKey)?,
                )
                .map_err(|_| SyncError::InvalidKey)?,
        );
        if bytes.len() != 32 {
            return Err(SyncError::InvalidKey);
        }
        Ok(Self(
            XChaCha20Poly1305::new_from_slice(&bytes).map_err(|_| SyncError::InvalidKey)?,
        ))
    }

    pub(super) fn seal(&self, vault: &str, kind: &str, bytes: &[u8]) -> Result<Vec<u8>, SyncError> {
        if bytes.len() > MAX_OBJECT_BYTES {
            return Err(SyncError::TooLarge);
        }
        let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
        let aad = format!("zicode.notes.sync.v1/{vault}/{kind}");
        let ciphertext = self
            .0
            .encrypt(
                &nonce,
                Payload {
                    msg: bytes,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| SyncError::InvalidData)?;
        let mut envelope = Vec::with_capacity(4 + 24 + ciphertext.len());
        envelope.extend_from_slice(MAGIC);
        envelope.extend_from_slice(&nonce);
        envelope.extend_from_slice(&ciphertext);
        Ok(envelope)
    }

    pub(super) fn open(&self, vault: &str, kind: &str, bytes: &[u8]) -> Result<Vec<u8>, SyncError> {
        if bytes.len() < 44 || bytes.len() > MAX_OBJECT_BYTES + 44 || &bytes[..4] != MAGIC {
            return Err(SyncError::Decryption);
        }
        let aad = format!("zicode.notes.sync.v1/{vault}/{kind}");
        self.0
            .decrypt(
                XNonce::from_slice(&bytes[4..28]),
                Payload {
                    msg: &bytes[28..],
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| SyncError::Decryption)
    }
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
