//! M3 端到端加密：Noise_XK（X25519 + ChaCha20-Poly1305）。
//!
//! 手机在配对时通过桌面二维码/链接带外获得桌面静态公钥并固定，随后经中继
//! WebSocket 完成 Noise_XK 握手。握手完成后，数据面所有应用帧都封装为
//! `{"type":"e2ee_frame","v":1,"data":"<base64 密文>"}`，中继只转发密文，
//! 无法读取会话内容、设备令牌或提示词。

use base64::Engine;
use snow::{params::NoiseParams, Builder, HandshakeState, TransportState};
use std::sync::Arc;

const KEYRING_SERVICE: &str = "ZiCode Studio Desktop";
const E2EE_KEYRING_ACCOUNT: &str = "remote-access-e2ee-identity-v1";

pub const E2EE_VERSION: u32 = 1;
pub const E2EE_HANDSHAKE_TYPE: &str = "e2ee_handshake";
pub const E2EE_FRAME_TYPE: &str = "e2ee_frame";

fn noise_params() -> NoiseParams {
    "Noise_XK_25519_ChaChaPoly_SHA256"
        .parse()
        .expect("static noise parameters")
}

/// Desktop 长期 E2EE 身份：静态 X25519 密钥对，私钥存系统凭据库。
/// 公钥在配对时带外分发给手机，握手前由手机固定（防中继中间人）。
pub struct E2eeIdentity {
    keypair: snow::Keypair,
}

impl std::fmt::Debug for E2eeIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("E2eeIdentity")
            .field("public_key", &self.public_key_base64())
            .field("fingerprint", &self.fingerprint())
            .finish_non_exhaustive()
    }
}

impl E2eeIdentity {
    pub fn load_or_create() -> Result<Self, String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, E2EE_KEYRING_ACCOUNT)
            .map_err(|error| format!("Cannot open the system credential vault: {error}"))?;
        match entry.get_password() {
            Ok(value) => Self::from_private_base64(&value),
            Err(keyring::Error::NoEntry) => {
                let identity = Self::generate()?;
                entry
                    .set_password(&identity.private_base64())
                    .map_err(|error| format!("Cannot store the E2EE identity key: {error}"))?;
                Ok(identity)
            }
            Err(error) => Err(format!("Cannot read the E2EE identity key: {error}")),
        }
    }

    pub fn generate() -> Result<Self, String> {
        let keypair = Builder::new(noise_params())
            .generate_keypair()
            .map_err(|error| format!("Cannot generate the E2EE identity key: {error}"))?;
        Ok(Self { keypair })
    }

    pub fn from_private_base64(value: &str) -> Result<Self, String> {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(value.trim())
            .map_err(|error| format!("Invalid E2EE identity key encoding: {error}"))?;
        let private: [u8; 32] = decoded
            .try_into()
            .map_err(|_| "E2EE identity key must be 32 bytes".to_string())?;
        Ok(Self::from_private_bytes(private))
    }

    /// Rebuild the keypair from persisted private bytes; the public half is
    /// derived deterministically with x25519 (same curve snow uses).
    pub fn from_private_bytes(private: [u8; 32]) -> Self {
        let secret = x25519_dalek::StaticSecret::from(private);
        let public = x25519_dalek::PublicKey::from(&secret).to_bytes();
        Self {
            keypair: snow::Keypair {
                private: private.to_vec(),
                public: public.to_vec(),
            },
        }
    }

    pub fn public_key(&self) -> [u8; 32] {
        self.keypair
            .public
            .clone()
            .try_into()
            .expect("x25519 public key is 32 bytes")
    }

    pub fn public_key_base64(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(self.public_key())
    }

    pub fn private_base64(&self) -> String {
        base64::engine::general_purpose::STANDARD.encode(&self.keypair.private)
    }

    /// SHA-256 fingerprint of the public key, lowercase hex pairs separated
    /// by colons, for human comparison in the settings UI.
    pub fn fingerprint(&self) -> String {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(self.public_key());
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<Vec<_>>()
            .join(":")
    }
}

pub type E2eeIdentityRef = Arc<E2eeIdentity>;

/// Noise_XK 响应方（桌面侧）：等待手机发起握手，完成后进入传输模式。
pub struct E2eeResponder {
    state: Option<HandshakeState>,
    transport: Option<TransportState>,
}

impl E2eeResponder {
    pub fn new(identity: &E2eeIdentity) -> Result<Self, String> {
        let state = Builder::new(noise_params())
            .local_private_key(&identity.keypair.private)
            .build_responder()
            .map_err(|error| format!("Cannot start the Noise responder: {error}"))?;
        Ok(Self {
            state: Some(state),
            transport: None,
        })
    }

    /// 处理手机发来的一帧握手消息。返回 `Ok(None)` 表示握手完成（此后调用
    /// `encrypt`/`decrypt`）；返回 `Ok(Some(bytes))` 表示需要把该响应发回手机。
    pub fn accept(&mut self, message: &[u8]) -> Result<Option<Vec<u8>>, String> {
        let mut state = self
            .state
            .take()
            .ok_or("E2EE handshake is already finished")?;
        let mut payload = [0u8; 512];
        state
            .read_message(message, &mut payload)
            .map_err(|error| format!("E2EE handshake rejected: {error}"))?;
        if state.is_handshake_finished() {
            let transport = state
                .into_transport_mode()
                .map_err(|error| format!("Cannot start the E2EE transport: {error}"))?;
            self.transport = Some(transport);
            Ok(None)
        } else {
            let mut response = [0u8; 512];
            let len = state
                .write_message(&[], &mut response)
                .map_err(|error| format!("Cannot write the E2EE handshake response: {error}"))?;
            self.state = Some(state);
            Ok(Some(response[..len].to_vec()))
        }
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let transport = self
            .transport
            .as_mut()
            .ok_or("E2EE transport is not ready")?;
        let mut out = vec![0u8; plaintext.len() + 64];
        let len = transport
            .write_message(plaintext, &mut out)
            .map_err(|error| format!("Cannot encrypt the E2EE frame: {error}"))?;
        out.truncate(len);
        Ok(out)
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let transport = self
            .transport
            .as_mut()
            .ok_or("E2EE transport is not ready")?;
        let mut out = vec![0u8; ciphertext.len()];
        let len = transport
            .read_message(ciphertext, &mut out)
            .map_err(|error| format!("Cannot decrypt the E2EE frame: {error}"))?;
        out.truncate(len);
        Ok(out)
    }
}

/// Noise_XK 发起方（手机侧等价逻辑；当前用于 Rust 测试与协议对照）。
#[cfg(test)]
pub struct E2eeInitiator {
    state: Option<HandshakeState>,
    transport: Option<TransportState>,
}

#[cfg(test)]
impl E2eeInitiator {
    pub fn new(remote_public: &[u8; 32]) -> Result<Self, String> {
        // Noise_XK 的第三帧 `-> s, se` 需要发起方静态密钥；会话级随机生成即可。
        let local = Builder::new(noise_params())
            .generate_keypair()
            .map_err(|error| format!("Cannot generate the Noise initiator key: {error}"))?;
        let state = Builder::new(noise_params())
            .local_private_key(&local.private)
            .remote_public_key(remote_public)
            .build_initiator()
            .map_err(|error| format!("Cannot start the Noise initiator: {error}"))?;
        Ok(Self {
            state: Some(state),
            transport: None,
        })
    }

    /// 发出第一帧握手消息（XK 的 `-> e`）。
    pub fn begin(&mut self) -> Result<Vec<u8>, String> {
        let mut state = self
            .state
            .take()
            .ok_or("E2EE handshake is already finished")?;
        let mut message = [0u8; 512];
        let len = state
            .write_message(&[], &mut message)
            .map_err(|error| format!("Cannot begin the E2EE handshake: {error}"))?;
        self.state = Some(state);
        Ok(message[..len].to_vec())
    }

    /// 处理响应方消息。返回 `Ok(None)` 表示握手完成；`Ok(Some(bytes))`
    /// 表示需要把该消息发回（XK 的 `-> s, se`）。
    pub fn advance(&mut self, message: &[u8]) -> Result<Option<Vec<u8>>, String> {
        let mut state = self
            .state
            .take()
            .ok_or("E2EE handshake is already finished")?;
        let mut payload = [0u8; 512];
        state
            .read_message(message, &mut payload)
            .map_err(|error| format!("E2EE handshake rejected: {error}"))?;
        if state.is_handshake_finished() {
            let transport = state
                .into_transport_mode()
                .map_err(|error| format!("Cannot start the E2EE transport: {error}"))?;
            self.transport = Some(transport);
            return Ok(None);
        }
        let mut response = [0u8; 512];
        let len = state
            .write_message(&[], &mut response)
            .map_err(|error| format!("Cannot write the E2EE handshake response: {error}"))?;
        if state.is_handshake_finished() {
            let transport = state
                .into_transport_mode()
                .map_err(|error| format!("Cannot start the E2EE transport: {error}"))?;
            self.transport = Some(transport);
        } else {
            self.state = Some(state);
        }
        Ok(Some(response[..len].to_vec()))
    }

    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let transport = self
            .transport
            .as_mut()
            .ok_or("E2EE transport is not ready")?;
        let mut out = vec![0u8; plaintext.len() + 64];
        let len = transport
            .write_message(plaintext, &mut out)
            .map_err(|error| format!("Cannot encrypt the E2EE frame: {error}"))?;
        out.truncate(len);
        Ok(out)
    }

    pub fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let transport = self
            .transport
            .as_mut()
            .ok_or("E2EE transport is not ready")?;
        let mut out = vec![0u8; ciphertext.len()];
        let len = transport
            .read_message(ciphertext, &mut out)
            .map_err(|error| format!("Cannot decrypt the E2EE frame: {error}"))?;
        out.truncate(len);
        Ok(out)
    }
}

/// 握手帧：`{"type":"e2ee_handshake","v":1,"msg":"<base64>"}`。
pub fn handshake_frame(message: &[u8]) -> String {
    serde_json::json!({
        "type": E2EE_HANDSHAKE_TYPE,
        "v": E2EE_VERSION,
        "msg": base64::engine::general_purpose::STANDARD.encode(message),
    })
    .to_string()
}

pub fn parse_handshake_frame(text: &str) -> Option<Vec<u8>> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value.get("type")?.as_str()? != E2EE_HANDSHAKE_TYPE {
        return None;
    }
    let message = value.get("msg")?.as_str()?;
    base64::engine::general_purpose::STANDARD
        .decode(message)
        .ok()
}

/// 加密数据帧：`{"type":"e2ee_frame","v":1,"data":"<base64 密文>"}`。
pub fn e2ee_frame(payload: &[u8]) -> String {
    serde_json::json!({
        "type": E2EE_FRAME_TYPE,
        "v": E2EE_VERSION,
        "data": base64::engine::general_purpose::STANDARD.encode(payload),
    })
    .to_string()
}

pub fn parse_e2ee_frame(text: &str) -> Option<Vec<u8>> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value.get("type")?.as_str()? != E2EE_FRAME_TYPE {
        return None;
    }
    let payload = value.get("data")?.as_str()?;
    base64::engine::general_purpose::STANDARD
        .decode(payload)
        .ok()
}

/// 完成一轮握手（供测试与协议对照使用）。
#[cfg(test)]
pub fn complete_handshake(
    responder: &mut E2eeResponder,
    initiator: &mut E2eeInitiator,
) -> Result<(), String> {
    let first = initiator.begin()?;
    let second = responder
        .accept(&first)?
        .ok_or("responder finished after the first message")?;
    let third = initiator.advance(&second)?;
    match third {
        Some(third) => {
            // 响应方读取第三帧后返回 Ok(None) 表示握手完成；Ok(Some) 意味着
            // 模式异常（响应方多写了一帧）。
            if responder.accept(&third)?.is_some() {
                return Err("responder produced an unexpected fourth handshake message".to_string());
            }
        }
        None => return Err("initiator finished before the third message".to_string()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_public_key_matches_snow_generated_keypair() {
        let identity = E2eeIdentity::generate().unwrap();
        let rebuilt = E2eeIdentity::from_private_base64(&identity.private_base64()).unwrap();
        assert_eq!(identity.public_key_base64(), rebuilt.public_key_base64());
        assert_eq!(identity.public_key(), rebuilt.public_key());
        assert!(identity.fingerprint().contains(':'));
        assert_eq!(identity.fingerprint().len(), 32 * 3 - 1);
    }

    #[test]
    fn rejects_malformed_identity_keys() {
        assert!(E2eeIdentity::from_private_base64("not base64").is_err());
        assert!(E2eeIdentity::from_private_base64(
            &base64::engine::general_purpose::STANDARD.encode([0u8; 16])
        )
        .is_err());
    }

    #[test]
    fn handshake_round_trip_encrypts_and_decrypts() {
        let identity = E2eeIdentity::generate().unwrap();
        let mut responder = E2eeResponder::new(&identity).unwrap();
        let mut initiator = E2eeInitiator::new(&identity.public_key()).unwrap();
        complete_handshake(&mut responder, &mut initiator).unwrap();

        let hello = br#"{"type":"hello","deviceToken":"secret-token"}"#;
        let ciphertext = initiator.encrypt(hello).unwrap();
        assert_ne!(ciphertext, hello);
        assert!(!String::from_utf8_lossy(&ciphertext).contains("secret-token"));
        assert_eq!(responder.decrypt(&ciphertext).unwrap(), hello);

        let ack = br#"{"type":"hello_ack"}"#;
        let ciphertext = responder.encrypt(ack).unwrap();
        assert_eq!(initiator.decrypt(&ciphertext).unwrap(), ack);
    }

    #[test]
    fn handshake_rejects_a_wrong_responder_static_key() {
        let identity = E2eeIdentity::generate().unwrap();
        let wrong = E2eeIdentity::generate().unwrap();
        let mut responder = E2eeResponder::new(&identity).unwrap();
        let mut initiator = E2eeInitiator::new(&wrong.public_key()).unwrap();

        let first = initiator.begin().unwrap();
        // snow 的 XK 第一帧是 `e, es`：用错误静态密钥派生 es，响应方在
        // 第一帧就解密失败，比等到第三帧才暴露更强。
        assert!(responder.accept(&first).is_err());
    }

    #[test]
    fn handshake_frames_round_trip_and_reject_unknown_types() {
        let message = b"handshake-bytes";
        let frame = handshake_frame(message);
        assert_eq!(parse_handshake_frame(&frame).unwrap(), message);
        assert!(parse_handshake_frame(r#"{"type":"other","msg":"AA=="}"#).is_none());
        assert!(parse_handshake_frame("not json").is_none());

        let payload = b"ciphertext";
        let frame = e2ee_frame(payload);
        assert_eq!(parse_e2ee_frame(&frame).unwrap(), payload);
        assert!(parse_e2ee_frame(&handshake_frame(message)).is_none());
    }
}
