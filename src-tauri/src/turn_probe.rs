//! TURN connectivity self-test for M2 acceptance.
//!
//! Derives a short-lived coturn REST credential and performs a minimal
//! TURN allocation exchange over UDP so the desktop can verify that the
//! configured `static-auth-secret` matches the server's, without a phone.

use base64::Engine;
use hmac::{Hmac, Mac};
use md5::Digest;
use sha1::Sha1;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::Duration;

const STUN_MAGIC_COOKIE: u32 = 0x2112_A442;
const ATTR_USERNAME: u16 = 0x0006;
const ATTR_MESSAGE_INTEGRITY: u16 = 0x0008;
const ATTR_REALM: u16 = 0x0014;
const ATTR_NONCE: u16 = 0x0015;
const TYPE_ALLOCATION: u16 = 0x0003;
const TYPE_ALLOCATION_RESPONSE: u16 = 0x0103;
const TYPE_ALLOCATION_ERROR: u16 = 0x0113;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnProbeResult {
    Ok,
    Unauthenticated,
    Unreachable(String),
    Protocol(String),
}

fn read_u16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([bytes[offset], bytes[offset + 1]])
}

fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
    bytes[offset] = (value >> 8) as u8;
    bytes[offset + 1] = value as u8;
}

struct StunMessage {
    message_type: u16,
    transaction_id: [u8; 12],
    attributes: Vec<(u16, Vec<u8>)>,
}

impl StunMessage {
    fn encode(&self, with_integrity: Option<&[u8]>) -> Vec<u8> {
        let attr_bytes: usize = self
            .attributes
            .iter()
            .map(|(_, value)| 4 + value.len().next_multiple_of(4))
            .sum::<usize>()
            + if with_integrity.is_some() { 24 } else { 0 };
        let mut message = vec![0u8; 20 + attr_bytes];
        write_u16(&mut message, 0, self.message_type);
        let length = attr_bytes as u16;
        write_u16(&mut message, 2, length);
        message[4..8].copy_from_slice(&STUN_MAGIC_COOKIE.to_be_bytes());
        message[8..20].copy_from_slice(&self.transaction_id);
        let mut cursor = 20usize;
        for (attribute_type, value) in &self.attributes {
            write_u16(&mut message, cursor, *attribute_type);
            write_u16(&mut message, cursor + 2, value.len() as u16);
            message[cursor + 4..cursor + 4 + value.len()].copy_from_slice(value);
            cursor += 4 + value.len().next_multiple_of(4);
        }
        if let Some(key) = with_integrity {
            write_u16(&mut message, cursor, ATTR_MESSAGE_INTEGRITY);
            write_u16(&mut message, cursor + 2, 20);
            let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(key).expect("hmac key");
            mac.update(&message);
            let digest = mac.finalize().into_bytes();
            message[cursor + 4..cursor + 24].copy_from_slice(&digest);
        }
        message
    }

    fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < 20 {
            return Err("TURN response too short".into());
        }
        if read_u32(bytes, 4) != STUN_MAGIC_COOKIE {
            return Err("TURN response has an invalid magic cookie".into());
        }
        let length = read_u16(bytes, 2) as usize;
        if 20 + length > bytes.len() {
            return Err("TURN response is truncated".into());
        }
        let mut transaction_id = [0u8; 12];
        transaction_id.copy_from_slice(&bytes[8..20]);
        let mut attributes = Vec::new();
        let mut cursor = 20usize;
        while cursor + 4 <= 20 + length {
            let attribute_type = read_u16(bytes, cursor);
            let attribute_length = read_u16(bytes, cursor + 2) as usize;
            let end = cursor + 4 + attribute_length;
            if end > 20 + length {
                break;
            }
            attributes.push((attribute_type, bytes[cursor + 4..end].to_vec()));
            cursor = end.next_multiple_of(4);
        }
        Ok(Self {
            message_type: read_u16(bytes, 0),
            transaction_id,
            attributes,
        })
    }

    fn attribute(&self, attribute_type: u16) -> Option<&[u8]> {
        self.attributes
            .iter()
            .find(|(entry_type, _)| *entry_type == attribute_type)
            .map(|(_, value)| value.as_slice())
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]])
}

fn derive_username_and_credential(secret: &str, device_id: &str) -> (String, String) {
    let expiry = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() + 3600)
        .unwrap_or(1_800_000_000);
    let username = format!("{expiry}:{device_id}");
    let credential = derive_credential_for_username(secret, &username);
    (username, credential)
}

/// coturn auth-secret password for an exact username:
/// unpadded base64 of HMAC-SHA1(secret, username).
fn derive_credential_for_username(secret: &str, username: &str) -> String {
    let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(username.as_bytes());
    base64::engine::general_purpose::STANDARD
        .encode(mac.finalize().into_bytes())
        .trim_end_matches('=')
        .to_string()
}

fn parse_turn_host_port(turn_url: &str) -> Result<SocketAddr, String> {
    let rest = turn_url
        .strip_prefix("turn:")
        .or_else(|| turn_url.strip_prefix("turns:"))
        .ok_or_else(|| "TURN URL must start with turn: or turns:".to_string())?;
    let host_port = rest.split(['?', '#']).next().unwrap_or_default();
    let host_port = if host_port.contains("://") {
        host_port.split("://").nth(1).unwrap_or(host_port)
    } else {
        host_port
    };
    let (host, port) = if let Some((host, port)) = host_port.rsplit_once(':') {
        (host, port.parse::<u16>().map_err(|_| "invalid TURN port".to_string())?)
    } else {
        (host_port, 3478)
    };
    let address = format!("{host}:{port}")
        .to_socket_addrs()
        .map_err(|error| format!("cannot resolve TURN host: {error}"))?
        .next()
        .ok_or_else(|| "TURN host did not resolve".to_string())?;
    Ok(address)
}

fn allocation_request(
    transaction_id: [u8; 12],
    username: Option<&str>,
    realm: Option<&str>,
    nonce: Option<&str>,
    key: Option<&[u8]>,
) -> Vec<u8> {
    let mut message = StunMessage {
        message_type: TYPE_ALLOCATION,
        transaction_id,
        attributes: vec![(0x8022, vec![0, 0, 0, 5])],
    };
    if let Some(username) = username {
        message.attributes.push((ATTR_USERNAME, username.as_bytes().to_vec()));
    }
    if let Some(realm) = realm {
        message.attributes.push((ATTR_REALM, realm.as_bytes().to_vec()));
    }
    if let Some(nonce) = nonce {
        message.attributes.push((ATTR_NONCE, nonce.as_bytes().to_vec()));
    }
    message.encode(key)
}

/// Run the TURN allocation probe against the configured server.
pub fn probe_turn(
    turn_url: &str,
    realm: &str,
    secret: &str,
    device_id: &str,
) -> TurnProbeResult {
    let address = match parse_turn_host_port(turn_url) {
        Ok(address) => address,
        Err(error) => return TurnProbeResult::Protocol(error),
    };
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(socket) => socket,
        Err(error) => return TurnProbeResult::Unreachable(format!("bind failed: {error}")),
    };
    if let Err(error) = socket.set_read_timeout(Some(Duration::from_secs(5))) {
        return TurnProbeResult::Protocol(format!("set timeout failed: {error}"));
    }
    let mut transaction_id = [0u8; 12];
    transaction_id.copy_from_slice(&uuid::Uuid::new_v4().as_bytes()[..12]);
    let (username, credential) = derive_username_and_credential(secret, device_id);
    let key = turn_key(&username, realm, &credential);

    let first = allocation_request(transaction_id, None, None, None, None);
    if let Err(error) = socket.send_to(&first, address) {
        return TurnProbeResult::Unreachable(format!("send failed: {error}"));
    }
    let mut buffer = [0u8; 2048];
    let (size, _) = match socket.recv_from(&mut buffer) {
        Ok(received) => received,
        Err(error) => return TurnProbeResult::Unreachable(format!("receive failed: {error}")),
    };
    let challenge = match StunMessage::parse(&buffer[..size]) {
        Ok(message) => message,
        Err(error) => return TurnProbeResult::Protocol(error),
    };
    if challenge.transaction_id != transaction_id {
        return TurnProbeResult::Protocol("TURN challenge transaction id mismatch".into());
    }
    let challenge_realm = challenge
        .attribute(ATTR_REALM)
        .and_then(|value| std::str::from_utf8(value).ok())
        .unwrap_or(realm);
    let nonce = match challenge
        .attribute(ATTR_NONCE)
        .and_then(|value| std::str::from_utf8(value).ok())
    {
        Some(nonce) => nonce,
        None => return TurnProbeResult::Protocol("TURN challenge missing nonce".to_string()),
    };

    let second = allocation_request(
        transaction_id,
        Some(&username),
        Some(challenge_realm),
        Some(nonce),
        Some(&key),
    );
    if let Err(error) = socket.send_to(&second, address) {
        return TurnProbeResult::Unreachable(format!("send failed: {error}"));
    }
    let (size, _) = match socket.recv_from(&mut buffer) {
        Ok(received) => received,
        Err(error) => return TurnProbeResult::Unreachable(format!("receive failed: {error}")),
    };
    let response = match StunMessage::parse(&buffer[..size]) {
        Ok(message) => message,
        Err(error) => return TurnProbeResult::Protocol(error),
    };
    if response.transaction_id != transaction_id {
        return TurnProbeResult::Protocol("TURN response transaction id mismatch".into());
    }
    match response.message_type {
        TYPE_ALLOCATION_RESPONSE => TurnProbeResult::Ok,
        TYPE_ALLOCATION_ERROR => TurnProbeResult::Unauthenticated,
        other => TurnProbeResult::Protocol(format!(
            "unexpected TURN response type 0x{other:04x}"
        )),
    }
}

/// RFC 5389 long-term credential key: `MD5(username:realm:credential)`,
/// where `credential` is the coturn auth-secret derived password.
fn turn_key(username: &str, realm: &str, credential: &str) -> Vec<u8> {
    let mut hasher = md5::Md5::new();
    hasher.update(username.as_bytes());
    hasher.update(b":");
    hasher.update(realm.as_bytes());
    hasher.update(b":");
    hasher.update(credential.as_bytes());
    hasher.finalize().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::UdpSocket;
    use std::thread;

    fn allocate_mock(secret: &str, realm: &str) -> SocketAddr {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let address = socket.local_addr().unwrap();
        let secret = secret.to_string();
        let realm = realm.to_string();
        thread::spawn(move || {
            let mut buffer = [0u8; 2048];
            let mut responded = false;
            while !responded {
                let Ok((size, peer)) = socket.recv_from(&mut buffer) else {
                    break;
                };
                let message = StunMessage::parse(&buffer[..size]).unwrap();
                let transaction_id = message.transaction_id;
                if message.attribute(ATTR_USERNAME).is_none() {
                    // Challenge: 401 with realm + nonce.
                    let challenge = StunMessage {
                        message_type: TYPE_ALLOCATION_ERROR,
                        transaction_id,
                        attributes: vec![
                            (ATTR_REALM, realm.as_bytes().to_vec()),
                            (ATTR_NONCE, b"nonce-1234".to_vec()),
                        ],
                    }
                    .encode(None);
                    let _ = socket.send_to(&challenge, peer);
                    continue;
                }
                // Validate the message integrity against the shared secret.
                let username = std::str::from_utf8(message.attribute(ATTR_USERNAME).unwrap()).unwrap();
                let received_realm = std::str::from_utf8(message.attribute(ATTR_REALM).unwrap()).unwrap();
                let credential = derive_credential_for_username(&secret, username);
                let key = turn_key(username, received_realm, &credential);
                // Recompute the STUN message-integrity over the exact bytes
                // the client sent (everything before the integrity attribute).
                let client_message = buffer[..size].to_vec();
                let message_length = read_u16(&client_message, 2) as usize;
                let mut mac = <Hmac<Sha1> as Mac>::new_from_slice(&key).unwrap();
                // The MAC covers the header and every attribute up to and
                // including the integrity attribute header, with the 20-byte
                // value itself zeroed during the computation.
                mac.update(&client_message[..20 + message_length - 20]);
                mac.update(&[0u8; 20]);
                let expected = mac.finalize().into_bytes();
                let provided = client_message
                    [20 + message_length - 20..20 + message_length]
                    .to_vec();
                let ok = expected.as_slice() == provided.as_slice();
                let response = StunMessage {
                    message_type: if ok {
                        TYPE_ALLOCATION_RESPONSE
                    } else {
                        TYPE_ALLOCATION_ERROR
                    },
                    transaction_id,
                    attributes: if ok {
                        vec![(0x0016, vec![0, 0, 0, 4, 127, 0, 0, 1, 1, 2, 3, 4])]
                    } else {
                        vec![]
                    },
                }
                .encode(None);
                let _ = socket.send_to(&response, peer);
                responded = true;
            }
        });
        address
    }

    #[test]
    fn probe_succeeds_when_the_server_accepts_the_derived_credential() {
        let secret = "north";
        let realm = "turn.example.com";
        let address = allocate_mock(secret, realm);
        let turn_url = format!("turn:{address}");
        assert_eq!(
            probe_turn(&turn_url, realm, secret, "dev-ax2-01"),
            TurnProbeResult::Ok
        );
    }

    #[test]
    fn derives_the_coturn_rest_known_vector_and_rfc5389_key() {
        // RFC 5389 auth-secret example used by coturn's REST API docs.
        let credential = derive_credential_for_username("north", "1234567890:user");
        assert_eq!(credential, "yqWhSUayifUHn5H27OXq5rL3//A");
        // MD5(username:realm:credential) is the long-term credential key.
        assert_eq!(
            turn_key("1234567890:user", "turn.example.com", &credential),
            vec![
                0x72, 0x64, 0x28, 0x5f, 0xce, 0x49, 0x5c, 0xdb, 0xf7, 0xd0, 0x36, 0x96, 0x88,
                0x54, 0x22, 0xd5
            ]
        );
    }

    #[test]
    fn probe_reports_unauthenticated_when_the_secret_mismatches() {
        let secret = "north";
        let realm = "turn.example.com";
        let address = allocate_mock(secret, realm);
        let turn_url = format!("turn:{address}");
        assert_eq!(
            probe_turn(&turn_url, realm, "wrong-secret", "dev-ax2-01"),
            TurnProbeResult::Unauthenticated
        );
    }
}
