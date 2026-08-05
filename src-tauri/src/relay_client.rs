//! Desktop relay agent (M1): keeps an outbound WebSocket connection to the
//! rendezvous relay and bridges HTTP requests / WebSocket sessions to the
//! local strict public gateway (127.0.0.1:57682). The gateway remains the
//! authentication authority: the agent is a transport pipe and never grants
//! itself loopback privileges.

use crate::relay_protocol::RelayFrame;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{header, HeaderValue};
use tokio_tungstenite::tungstenite::Message as WsMessage;

#[derive(Debug)]
struct AcceptAnyCertificate;

impl ServerCertVerifier for AcceptAnyCertificate {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ED25519,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
        ]
    }
}

fn local_gateway_connector() -> &'static tokio_tungstenite::Connector {
    static CONNECTOR: OnceLock<tokio_tungstenite::Connector> = OnceLock::new();
    CONNECTOR.get_or_init(|| {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let config = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAnyCertificate))
            .with_no_client_auth();
        tokio_tungstenite::Connector::Rustls(Arc::new(config))
    })
}

#[derive(Debug, Clone)]
pub struct RelayAgentConfig {
    pub relay_url: String,
    pub device_id: String,
    /// Local strict gateway origin, e.g. `https://127.0.0.1:57682`.
    pub gateway_origin: String,
    /// Public page origin the mobile uses, e.g. `https://relay.zicode.com`.
    pub page_origin: String,
    /// Shared live connection state for the settings/status surface.
    pub status: RelayAgentStatus,
    /// M3 E2EE identity; `None` keeps the M1 transparent bridge.
    pub e2ee_identity: Option<crate::e2ee::E2eeIdentityRef>,
}

/// Live state of the desktop relay agent, shared with the Host so the
/// settings panel can show whether the rendezvous connection is really up.
#[derive(Debug, Clone, Default)]
pub struct RelayAgentState {
    pub connected: bool,
    pub connected_at: Option<u64>,
    pub last_error: Option<String>,
}

pub type RelayAgentStatus = Arc<Mutex<RelayAgentState>>;

/// Extract the scheme+host origin from a page URL so WebSocket Origin checks
/// (which never include a path) match the published address.
pub fn page_origin_of(url: &str) -> Option<String> {
    let idx = url.find("://")?;
    let scheme = &url[..idx + 3];
    let rest = &url[idx + 3..];
    let host = rest.split(['/', '?', '#']).next()?;
    if host.is_empty() {
        None
    } else {
        Some(format!("{scheme}{host}"))
    }
}

struct SessionHandle {
    tx: mpsc::UnboundedSender<WsMessage>,
    handle: tokio::task::JoinHandle<()>,
}

/// 会话桥接模式：M1 透明转发，或 Noise_XK 握手/密文转发。
enum SessionMode {
    Transparent,
    Handshake(crate::e2ee::E2eeResponder),
    Encrypted(crate::e2ee::E2eeResponder),
}

pub async fn run(config: RelayAgentConfig, mut shutdown: oneshot::Receiver<()>) {
    let mut backoff_seconds = 1u64;
    loop {
        if let Ok(mut state) = config.status.lock() {
            state.connected = false;
        }
        let attempt = run_once(&config);
        tokio::select! {
            _ = &mut shutdown => return,
            outcome = attempt => {
                if let Err(error) = outcome {
                    log::error!("[relay-agent] relay connection ended: {error}");
                    if let Ok(mut state) = config.status.lock() {
                        state.connected = false;
                        state.last_error = Some(error);
                    }
                }
            }
        }
        tokio::select! {
            _ = &mut shutdown => return,
            _ = tokio::time::sleep(Duration::from_secs(backoff_seconds)) => {}
        }
        backoff_seconds = (backoff_seconds * 2).min(30);
    }
}

async fn run_once(config: &RelayAgentConfig) -> Result<(), String> {
    let relay_endpoint = format!("{}/relay/desktop", config.relay_url.trim_end_matches('/'));
    let request = relay_endpoint
        .as_str()
        .into_client_request()
        .map_err(|error| error.to_string())?;
    let (mut relay_ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| error.to_string())?;
    if let Ok(mut state) = config.status.lock() {
        state.connected = true;
        state.connected_at = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or_default(),
        );
        state.last_error = None;
    }
    relay_ws
        .send(WsMessage::Text(
            RelayFrame::Hello {
                device_id: config.device_id.clone(),
                kind: "desktop".into(),
            }
            .to_json(),
        ))
        .await
        .map_err(|error| error.to_string())?;

    let (outgoing_tx, mut outgoing_rx) = mpsc::unbounded_channel::<RelayFrame>();
    let sessions: Arc<Mutex<HashMap<String, SessionHandle>>> = Arc::new(Mutex::new(HashMap::new()));
    let http_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .no_proxy()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| error.to_string())?;
    let (mut sink, mut stream) = relay_ws.split();

    loop {
        tokio::select! {
            message = stream.next() => {
                let Some(Ok(message)) = message else { break };
                let text = match message {
                    WsMessage::Text(text) => text,
                    WsMessage::Close(_) => break,
                    _ => continue,
                };
                let Ok(frame) = RelayFrame::parse(&text) else { continue };
                match frame {
                    RelayFrame::SessionOpen { sid } => {
                        if sessions
                            .lock()
                            .expect("relay agent sessions poisoned")
                            .contains_key(&sid)
                        {
                            continue;
                        }
                        let (local_tx, local_rx) = mpsc::unbounded_channel::<WsMessage>();
                        let handle = tokio::spawn(session_task(
                            config.clone(),
                            sid.clone(),
                            local_rx,
                            outgoing_tx.clone(),
                        ));
                        sessions
                            .lock()
                            .expect("relay agent sessions poisoned")
                            .insert(sid, SessionHandle { tx: local_tx, handle });
                    }
                    RelayFrame::WsFrame { sid, payload, binary } => {
                        let message = if binary {
                            let bytes = base64::engine::general_purpose::STANDARD
                                .decode(&payload)
                                .unwrap_or_default();
                            WsMessage::Binary(bytes)
                        } else {
                            WsMessage::Text(payload)
                        };
                        if let Some(handle) = sessions
                            .lock()
                            .expect("relay agent sessions poisoned")
                            .get(&sid)
                        {
                            let _ = handle.tx.send(message);
                        }
                    }
                    RelayFrame::Http { rid, method, path, headers, body } => {
                        let client = http_client.clone();
                        let config = config.clone();
                        let outgoing = outgoing_tx.clone();
                        tokio::spawn(async move {
                            let response =
                                execute_http(&client, &config, rid, &method, &path, &headers, &body)
                                    .await;
                            let _ = outgoing.send(response);
                        });
                    }
                    RelayFrame::SessionClose { sid } => {
                        if let Some(handle) = sessions
                            .lock()
                            .expect("relay agent sessions poisoned")
                            .remove(&sid)
                        {
                            handle.handle.abort();
                        }
                    }
                    RelayFrame::SessionError { sid, error } => {
                        if let Some(handle) = sessions
                            .lock()
                            .expect("relay agent sessions poisoned")
                            .remove(&sid)
                        {
                            handle.handle.abort();
                        }
                        log::warn!("[relay-agent] session {sid} failed: {error}");
                    }
                    RelayFrame::Hello { .. }
                    | RelayFrame::Welcome { .. }
                    | RelayFrame::SessionReady { .. }
                    | RelayFrame::HttpResp { .. } => {}
                }
            }
            frame = outgoing_rx.recv() => {
                let Some(frame) = frame else { break };
                if sink.send(WsMessage::Text(frame.to_json())).await.is_err() {
                    break;
                }
            }
        }
    }

    let handles: Vec<_> = sessions
        .lock()
        .expect("relay agent sessions poisoned")
        .drain()
        .map(|(_, handle)| handle.handle)
        .collect();
    for handle in handles {
        handle.abort();
    }
    Ok(())
}

async fn session_task(
    config: RelayAgentConfig,
    sid: String,
    mut local_rx: mpsc::UnboundedReceiver<WsMessage>,
    outgoing: mpsc::UnboundedSender<RelayFrame>,
) {
    let gateway_ws_origin = config.gateway_origin.replacen("https://", "wss://", 1);
    let request = match format!("{gateway_ws_origin}/v2/ws").into_client_request() {
        Ok(mut request) => {
            match HeaderValue::from_str(&config.page_origin) {
                Ok(origin) => {
                    request.headers_mut().insert(header::ORIGIN, origin);
                }
                Err(error) => {
                    let _ = outgoing.send(RelayFrame::SessionError {
                        sid,
                        error: error.to_string(),
                    });
                    return;
                }
            }
            request
        }
        Err(error) => {
            let _ = outgoing.send(RelayFrame::SessionError {
                sid,
                error: error.to_string(),
            });
            return;
        }
    };
    let (local_ws, _) = match tokio_tungstenite::connect_async_tls_with_config(
        request,
        None,
        false,
        Some(local_gateway_connector().clone()),
    )
    .await
    {
        Ok(socket) => socket,
        Err(error) => {
            let _ = outgoing.send(RelayFrame::SessionError {
                sid,
                error: error.to_string(),
            });
            return;
        }
    };
    let _ = outgoing.send(RelayFrame::SessionReady { sid: sid.clone() });
    let (mut sink, mut stream) = local_ws.split();

    // 首帧决定会话模式：`e2ee_handshake` 进入 Noise_XK 密文桥接，其余保持
    // M1 透明转发。握手期间本地网关保持静默，直到手机把加密后的 hello 发来。
    let mut mode = match local_rx.recv().await {
        Some(message) => match &message {
            WsMessage::Text(text) => match crate::e2ee::parse_handshake_frame(text) {
                Some(handshake) => {
                    let Some(identity) = config.e2ee_identity.clone() else {
                        let _ = outgoing.send(RelayFrame::SessionError {
                            sid,
                            error: "E2EE is not enabled on this desktop".to_string(),
                        });
                        return;
                    };
                    let mut responder = match crate::e2ee::E2eeResponder::new(&identity) {
                        Ok(responder) => responder,
                        Err(error) => {
                            let _ = outgoing.send(RelayFrame::SessionError {
                                sid,
                                error: format!("e2ee: {error}"),
                            });
                            return;
                        }
                    };
                    match responder.accept(&handshake) {
                        Ok(Some(response)) => {
                            let _ = outgoing.send(RelayFrame::WsFrame {
                                sid: sid.clone(),
                                payload: crate::e2ee::handshake_frame(&response),
                                binary: false,
                            });
                            SessionMode::Handshake(responder)
                        }
                        Ok(None) => SessionMode::Encrypted(responder),
                        Err(error) => {
                            let _ = outgoing.send(RelayFrame::SessionError {
                                sid,
                                error: format!("e2ee: {error}"),
                            });
                            return;
                        }
                    }
                }
                None => {
                    // M1：首帧（hello）原样转发给本地网关。
                    if sink.send(message).await.is_err() {
                        return;
                    }
                    SessionMode::Transparent
                }
            },
            _ => {
                if sink.send(message).await.is_err() {
                    return;
                }
                SessionMode::Transparent
            }
        },
        None => return,
    };

    loop {
        tokio::select! {
            incoming = local_rx.recv() => {
                let Some(message) = incoming else { break };
                match mode {
                    SessionMode::Transparent => {
                        if sink.send(message).await.is_err() {
                            break;
                        }
                    }
                    SessionMode::Handshake(ref mut responder) => {
                        let WsMessage::Text(text) = message else { break };
                        let Some(handshake) = crate::e2ee::parse_handshake_frame(&text) else {
                            let _ = outgoing.send(RelayFrame::SessionError {
                                sid: sid.clone(),
                                error: "e2ee: expected a handshake message".to_string(),
                            });
                            break;
                        };
                        match responder.accept(&handshake) {
                            Ok(Some(response)) => {
                                let _ = outgoing.send(RelayFrame::WsFrame {
                                    sid: sid.clone(),
                                    payload: crate::e2ee::handshake_frame(&response),
                                    binary: false,
                                });
                            }
                            Ok(None) => {
                                let responder = match std::mem::replace(
                                    &mut mode,
                                    SessionMode::Transparent,
                                ) {
                                    SessionMode::Handshake(responder) => responder,
                                    _ => unreachable!("mode was just matched as Handshake"),
                                };
                                mode = SessionMode::Encrypted(responder);
                            }
                            Err(error) => {
                                let _ = outgoing.send(RelayFrame::SessionError {
                                    sid: sid.clone(),
                                    error: format!("e2ee: {error}"),
                                });
                                break;
                            }
                        }
                    }
                    SessionMode::Encrypted(ref mut responder) => {
                        let WsMessage::Text(text) = message else { break };
                        let Some(ciphertext) = crate::e2ee::parse_e2ee_frame(&text) else {
                            let _ = outgoing.send(RelayFrame::SessionError {
                                sid: sid.clone(),
                                error: "e2ee: expected an encrypted frame".to_string(),
                            });
                            break;
                        };
                        match responder.decrypt(&ciphertext) {
                            Ok(plaintext) => {
                                let plaintext = String::from_utf8_lossy(&plaintext).into_owned();
                                if sink.send(WsMessage::Text(plaintext.into())).await.is_err() {
                                    break;
                                }
                            }
                            Err(error) => {
                                let _ = outgoing.send(RelayFrame::SessionError {
                                    sid: sid.clone(),
                                    error: format!("e2ee: {error}"),
                                });
                                break;
                            }
                        }
                    }
                }
            }
            message = stream.next() => {
                match message {
                    Some(Ok(WsMessage::Text(text))) => {
                        match mode {
                            SessionMode::Transparent | SessionMode::Handshake(_) => {
                                let _ = outgoing.send(RelayFrame::WsFrame {
                                    sid: sid.clone(),
                                    payload: text,
                                    binary: false,
                                });
                            }
                            SessionMode::Encrypted(ref mut responder) => {
                                match responder.encrypt(text.as_bytes()) {
                                    Ok(ciphertext) => {
                                        let _ = outgoing.send(RelayFrame::WsFrame {
                                            sid: sid.clone(),
                                            payload: crate::e2ee::e2ee_frame(&ciphertext),
                                            binary: false,
                                        });
                                    }
                                    Err(error) => {
                                        let _ = outgoing.send(RelayFrame::SessionError {
                                            sid: sid.clone(),
                                            error: format!("e2ee: {error}"),
                                        });
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    Some(Ok(WsMessage::Binary(bytes))) => {
                        let _ = outgoing.send(RelayFrame::WsFrame {
                            sid: sid.clone(),
                            payload: base64::engine::general_purpose::STANDARD.encode(&bytes),
                            binary: true,
                        });
                    }
                    Some(Ok(WsMessage::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }
    let _ = outgoing.send(RelayFrame::SessionClose { sid });
}

async fn execute_http(
    client: &reqwest::Client,
    config: &RelayAgentConfig,
    rid: u64,
    method: &str,
    path: &str,
    headers: &[(String, String)],
    body: &str,
) -> RelayFrame {
    let url = format!("{}{}", config.gateway_origin, path);
    let method_verb =
        reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut request = client.request(method_verb, &url);
    for (name, value) in headers {
        if let Ok(value) = HeaderValue::from_str(value) {
            request = request.header(name.as_str(), value);
        }
    }
    if !body.is_empty() {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(body)
            .unwrap_or_default();
        request = request.body(bytes);
    }
    match request.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            log::info!(
                "[relay-agent] {method} {path} -> {status}",
                method = method,
                path = path
            );
            let response_headers: Vec<(String, String)> = response
                .headers()
                .iter()
                .filter(|(name, _)| *name != header::CONTENT_LENGTH)
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.as_str().to_string(), value.to_string()))
                })
                .collect();
            let bytes = response.bytes().await.unwrap_or_default();
            RelayFrame::HttpResp {
                rid,
                status,
                headers: response_headers,
                body: base64::engine::general_purpose::STANDARD.encode(bytes),
            }
        }
        Err(error) => {
            log::warn!("[relay-agent] {method} {path} -> upstream error: {error}");
            RelayFrame::HttpResp {
                rid,
                status: 502,
                headers: vec![("content-type".to_string(), "text/plain".to_string())],
                body: base64::engine::general_purpose::STANDARD
                    .encode(format!("relay_agent_upstream_error: {error}")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{page_origin_of, RelayAgentState};

    #[test]
    fn relay_agent_state_starts_disconnected_without_error() {
        let state = RelayAgentState::default();
        assert!(!state.connected);
        assert_eq!(state.connected_at, None);
        assert_eq!(state.last_error, None);
    }

    #[test]
    fn extracts_origin_without_a_path() {
        assert_eq!(
            page_origin_of("https://relay.zicode.com/d/dev-1/app/workspaces/x"),
            Some("https://relay.zicode.com".to_string())
        );
        assert_eq!(
            page_origin_of("https://relay.zicode.com:8443/d/dev-1"),
            Some("https://relay.zicode.com:8443".to_string())
        );
        assert_eq!(page_origin_of("not a url"), None);
    }
}
