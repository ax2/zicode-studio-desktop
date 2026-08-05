//! Stateless rendezvous + relay for ZiCode mobile public access.
//!
//! The relay never stores content. It keeps only:
//! - which desktop `deviceId`s are currently connected (outbound WSS),
//! - live WebSocket sessions bridged between a mobile and a desktop,
//! - in-flight HTTP proxy requests.
//!
//! Mobile traffic is routed by a `device` cookie set when the user opens
//! `https://<relay>/d/<deviceId>/app/...`. The desktop agent performs the
//! actual HTTP/WebSocket work against its local strict gateway, so the relay
//! is a pure transport and the desktop remains the authentication authority.

use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::Router;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};
use tokio::time::Duration;

use crate::relay_protocol::RelayFrame;

const MAX_RELAY_FRAME_BYTES: usize = 20 * 1024 * 1024;
const HTTP_PROXY_TIMEOUT: Duration = Duration::from_secs(90);
const COOKIE_NAME: &str = "device";
const COOKIE_MAX_AGE: &str = "31536000";
const REGISTRATION_WINDOW_SECONDS: u64 = 60;
const REGISTRATION_MAX_PER_WINDOW: usize = 10;
const SESSION_CAP_PER_DEVICE: usize = 16;
const MAX_DEVICE_ID_LENGTH: usize = 128;

pub struct RelayState {
    desktops: HashMap<String, mpsc::UnboundedSender<RelayFrame>>,
    sessions: HashMap<String, Session>,
    http_pending: HashMap<u64, oneshot::Sender<HttpResponseData>>,
    next_rid: u64,
    /// M4: expected registration secret. `None` keeps the pre-M4 open mode
    /// (development only); when set, `/relay/desktop` registrations must
    /// present the matching token.
    pub registration_token: Option<String>,
    /// Per-source-IP registration attempt timestamps for rate limiting.
    registration_attempts: HashMap<IpAddr, VecDeque<u64>>,
    pub registration_max_per_window: usize,
    pub session_cap_per_device: usize,
    /// Per-device relayed byte accounting (in memory, resets on restart).
    usage: HashMap<String, DeviceUsage>,
    /// Optional per-device byte cap; `None` means unlimited.
    pub byte_quota_per_device: Option<u64>,
}

impl Default for RelayState {
    fn default() -> Self {
        Self {
            desktops: HashMap::new(),
            sessions: HashMap::new(),
            http_pending: HashMap::new(),
            next_rid: 0,
            registration_token: None,
            registration_attempts: HashMap::new(),
            registration_max_per_window: REGISTRATION_MAX_PER_WINDOW,
            session_cap_per_device: SESSION_CAP_PER_DEVICE,
            usage: HashMap::new(),
            byte_quota_per_device: None,
        }
    }
}

/// Cumulative relayed bytes for one desktop device (both directions).
#[derive(Clone, Debug, Default)]
pub struct DeviceUsage {
    pub bytes: u64,
    pub updated_at: u64,
    /// Day (unix seconds / 86400) the `bytes` counter belongs to. Counters
    /// reset when the day changes, so the quota is per device per day.
    pub day: u64,
}

struct Session {
    device_id: String,
    mobile_tx: mpsc::UnboundedSender<Message>,
}

#[derive(Clone, Debug, Default)]
struct HttpResponseData {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

fn valid_device_id(device_id: &str) -> bool {
    !device_id.is_empty()
        && device_id.len() <= MAX_DEVICE_ID_LENGTH
        && device_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn day_of(now_secs: u64) -> u64 {
    now_secs / 86400
}

/// Add `bytes` to the device's cumulative relayed usage. Returns `true` when
/// the device is still within its configured byte quota (or none is set).
fn record_usage_at(state: &mut RelayState, device_id: &str, bytes: u64, now: u64) -> bool {
    let usage = state.usage.entry(device_id.to_string()).or_default();
    let day = day_of(now);
    if usage.day != day {
        usage.bytes = 0;
        usage.day = day;
    }
    usage.bytes = usage.bytes.saturating_add(bytes);
    usage.updated_at = now;
    match state.byte_quota_per_device {
        Some(quota) => usage.bytes <= quota,
        None => true,
    }
}

fn record_usage(state: &mut RelayState, device_id: &str, bytes: u64) -> bool {
    record_usage_at(state, device_id, bytes, unix_now())
}

pub fn relay_router(state: Arc<Mutex<RelayState>>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/relay/status", get(relay_status))
        .route("/relay/desktop", get(desktop_ws))
        .route("/v2/ws", get(mobile_ws))
        .route("/d/{device_id}/{*path}", any(device_http))
        .route("/{*path}", any(proxy_http))
        .with_state(state)
}

async fn health() -> StatusCode {
    StatusCode::OK
}

async fn relay_status(State(state): State<Arc<Mutex<RelayState>>>) -> Response {
    let (desktops, sessions, usage, usage_day) = {
        let state = state.lock().expect("relay state poisoned");
        let mut desktops = state.desktops.keys().cloned().collect::<Vec<_>>();
        desktops.sort();
        let mut sessions = state.sessions.keys().cloned().collect::<Vec<_>>();
        sessions.sort();
        let today = day_of(unix_now());
        let mut usage = state
            .usage
            .iter()
            .map(|(device_id, usage)| {
                let bytes = if usage.day == today { usage.bytes } else { 0 };
                (device_id.clone(), bytes)
            })
            .collect::<Vec<_>>();
        usage.sort();
        (desktops, sessions, usage, today)
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::json!({
                "desktops": desktops,
                "sessions": sessions,
                "usage": usage,
                "usageDay": usage_day,
            })
            .to_string(),
        ))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn desktop_ws(
    State(state): State<Arc<Mutex<RelayState>>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.max_message_size(MAX_RELAY_FRAME_BYTES)
        .on_upgrade(move |socket| desktop_loop(state, socket, peer.ip()))
}

async fn desktop_loop(state: Arc<Mutex<RelayState>>, socket: WebSocket, peer_ip: IpAddr) {
    let (mut sink, mut stream) = socket.split();
    let mut hello = None;
    while let Some(Ok(message)) = stream.next().await {
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Close(_) => return,
            _ => continue,
        };
        if let Ok(RelayFrame::Hello {
            device_id,
            registration_token,
            ..
        }) = RelayFrame::parse(&text)
        {
            hello = Some((device_id, registration_token));
            break;
        }
    }
    let Some((device_id, registration_token)) = hello else {
        return;
    };

    let rejection = {
        let mut state = state.lock().expect("relay state poisoned");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        let max_per_window = state.registration_max_per_window;
        let attempts = state.registration_attempts.entry(peer_ip).or_default();
        attempts.retain(|attempt| *attempt + REGISTRATION_WINDOW_SECONDS >= now);
        let rate_limited = attempts.len() >= max_per_window;
        attempts.push_back(now);
        if rate_limited {
            Some("registration rate limited".to_string())
        } else if !valid_device_id(&device_id) {
            Some("invalid device id".to_string())
        } else if let Some(expected) = state.registration_token.as_deref() {
            if registration_token.as_deref() != Some(expected) {
                Some("registration token rejected".to_string())
            } else {
                None
            }
        } else {
            None
        }
    };
    if let Some(reason) = rejection {
        let _ = sink
            .send(Message::Text(
                RelayFrame::RegistrationRejected { reason }.to_json().into(),
            ))
            .await;
        return;
    }

    let (frame_tx, mut frame_rx) = mpsc::unbounded_channel::<RelayFrame>();
    {
        let mut state = state.lock().expect("relay state poisoned");
        state.desktops.remove(&device_id);
        state.desktops.insert(device_id.clone(), frame_tx.clone());
    }
    if sink
        .send(Message::Text(
            RelayFrame::Welcome {
                device_id: device_id.clone(),
            }
            .to_json()
            .into(),
        ))
        .await
        .is_err()
    {
        state
            .lock()
            .expect("relay state poisoned")
            .desktops
            .remove(&device_id);
        return;
    }
    let writer = tokio::spawn(async move {
        while let Some(frame) = frame_rx.recv().await {
            if sink
                .send(Message::Text(frame.to_json().into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    loop {
        let message = match stream.next().await {
            Some(Ok(message)) => message,
            _ => break,
        };
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Close(_) => break,
            _ => continue,
        };
        let Ok(frame) = RelayFrame::parse(&text) else {
            continue;
        };
        match frame {
            RelayFrame::WsFrame {
                sid,
                payload,
                binary,
            } => {
                let session = state
                    .lock()
                    .expect("relay state poisoned")
                    .sessions
                    .get(&sid)
                    .map(|session| session.mobile_tx.clone());
                if let Some(session) = session {
                    let message = if binary {
                        let bytes = base64::engine::general_purpose::STANDARD
                            .decode(&payload)
                            .unwrap_or_default();
                        Message::Binary(bytes.into())
                    } else {
                        Message::Text(payload.into())
                    };
                    let _ = session.send(message);
                }
            }
            RelayFrame::HttpResp {
                rid,
                status,
                headers,
                body,
            } => {
                let pending = state
                    .lock()
                    .expect("relay state poisoned")
                    .http_pending
                    .remove(&rid);
                if let Some(sender) = pending {
                    let _ = sender.send(HttpResponseData {
                        status,
                        headers,
                        body,
                    });
                }
            }
            RelayFrame::SessionReady { sid } => {
                // Readiness is informational in M1; frames flow either way.
                let _ = sid;
            }
            RelayFrame::SessionError { sid, error } => {
                close_session(&state, &sid, Some(format!("desktop_error:{error}")));
            }
            RelayFrame::SessionClose { sid } => {
                close_session(&state, &sid, None);
            }
            _ => {}
        }
    }
    writer.abort();
    state
        .lock()
        .expect("relay state poisoned")
        .desktops
        .remove(&device_id);
    let dead_sessions: Vec<String> = {
        let state = state.lock().expect("relay state poisoned");
        state
            .sessions
            .iter()
            .filter(|(_, session)| session.device_id == device_id)
            .map(|(sid, _)| sid.clone())
            .collect()
    };
    for sid in dead_sessions {
        close_session(&state, &sid, None);
    }
}

async fn mobile_ws(
    State(state): State<Arc<Mutex<RelayState>>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let Some(device_id) = device_from_cookie(&headers) else {
        return (StatusCode::BAD_REQUEST, "device cookie required").into_response();
    };
    let over_session_cap = {
        let state = state.lock().expect("relay state poisoned");
        state
            .sessions
            .values()
            .filter(|session| session.device_id == device_id)
            .count()
            >= state.session_cap_per_device
    };
    if over_session_cap {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            "device session limit reached",
        )
            .into_response();
    }
    ws.max_message_size(MAX_RELAY_FRAME_BYTES)
        .on_upgrade(move |socket| mobile_loop(state, device_id, socket))
}

async fn mobile_loop(state: Arc<Mutex<RelayState>>, device_id: String, socket: WebSocket) {
    let (sink, mut stream) = socket.split();
    let sink = Arc::new(tokio::sync::Mutex::new(sink));
    let desktop_tx = {
        let state = state.lock().expect("relay state poisoned");
        state.desktops.get(&device_id).cloned()
    };
    let Some(desktop_tx) = desktop_tx else {
        let _ = sink
            .lock()
            .await
            .send(Message::Text(
                serde_json::json!({
                    "type": "error",
                    "code": "desktop_offline",
                    "message": "ZiCode Studio Desktop is offline",
                })
                .to_string()
                .into(),
            ))
            .await;
        let _ = sink.lock().await.send(Message::Close(None)).await;
        return;
    };
    let sid = format!("s-{}", uuid::Uuid::new_v4().simple());
    let (mobile_tx, mut mobile_rx) = mpsc::unbounded_channel::<Message>();
    {
        let mut state = state.lock().expect("relay state poisoned");
        state.sessions.insert(
            sid.clone(),
            Session {
                device_id: device_id.clone(),
                mobile_tx,
            },
        );
    }
    if desktop_tx
        .send(RelayFrame::SessionOpen { sid: sid.clone() })
        .is_err()
    {
        close_session(&state, &sid, None);
        return;
    }
    let writer_state = state.clone();
    let writer_device = device_id.clone();
    let writer_sink = sink.clone();
    let writer = tokio::spawn(async move {
        while let Some(message) = mobile_rx.recv().await {
            let bytes = match &message {
                Message::Text(text) => text.len() as u64,
                Message::Binary(bytes) => bytes.len() as u64,
                _ => 0,
            };
            let under_quota = {
                let mut state = writer_state.lock().expect("relay state poisoned");
                record_usage(&mut state, &writer_device, bytes)
            };
            if !under_quota {
                let _ = writer_sink
                    .lock()
                    .await
                    .send(Message::Text(
                        serde_json::json!({
                            "type": "error",
                            "code": "device_quota_exceeded",
                            "message": "Device byte quota exceeded",
                        })
                        .to_string()
                        .into(),
                    ))
                    .await;
                break;
            }
            if writer_sink.lock().await.send(message).await.is_err() {
                break;
            }
        }
    });
    while let Some(Ok(message)) = stream.next().await {
        let (frame, bytes) = match message {
            Message::Text(text) => {
                let text = text.to_string();
                let bytes = text.len() as u64;
                (
                    RelayFrame::WsFrame {
                        sid: sid.clone(),
                        payload: text,
                        binary: false,
                    },
                    bytes,
                )
            }
            Message::Binary(bytes) => {
                let bytes_len = bytes.len() as u64;
                (
                    RelayFrame::WsFrame {
                        sid: sid.clone(),
                        payload: base64::engine::general_purpose::STANDARD.encode(&bytes),
                        binary: true,
                    },
                    bytes_len,
                )
            }
            Message::Close(_) => break,
            _ => continue,
        };
        let under_quota = {
            let mut state = state.lock().expect("relay state poisoned");
            record_usage(&mut state, &device_id, bytes)
        };
        if !under_quota {
            let _ = sink
                .lock()
                .await
                .send(Message::Text(
                    serde_json::json!({
                        "type": "error",
                        "code": "device_quota_exceeded",
                        "message": "Device byte quota exceeded",
                    })
                    .to_string()
                    .into(),
                ))
                .await;
            let _ = sink.lock().await.send(Message::Close(None)).await;
            break;
        }
        if desktop_tx.send(frame).is_err() {
            break;
        }
    }
    let _ = desktop_tx.send(RelayFrame::SessionClose { sid: sid.clone() });
    writer.abort();
    close_session(&state, &sid, None);
}

async fn device_http(
    State(state): State<Arc<Mutex<RelayState>>>,
    Path((device_id, path)): Path<(String, String)>,
    uri: axum::http::Uri,
    method: Method,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    // The mobile app only understands root-relative session routes
    // (`/app/workspaces/...`). A device-scoped URL (`/d/<device>/app/...`) is
    // the pairing bootstrap: set the device cookie and redirect to the clean
    // root path so route parsing, asset loading, and the PWA manifest work.
    if path == "app" || path.starts_with("app/") {
        let redirect_path = format!("/{path}");
        let location = match uri.query() {
            Some(query) => format!("{redirect_path}?{query}"),
            None => redirect_path,
        };
        let cookie = format!(
            "{COOKIE_NAME}={device_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age={COOKIE_MAX_AGE}"
        );
        let mut response = Response::builder()
            .status(StatusCode::FOUND)
            .header(header::LOCATION, location)
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            response.headers_mut().insert(header::SET_COOKIE, value);
        }
        return response;
    }
    let forwarded_path = if path.is_empty() {
        "/".to_string()
    } else {
        format!("/{path}")
    };
    let mut response = proxy_to_desktop(
        &state,
        &device_id,
        &forwarded_path,
        &method,
        &headers,
        &body,
    )
    .await;
    let cookie = format!(
        "{COOKIE_NAME}={device_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age={COOKIE_MAX_AGE}"
    );
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

async fn proxy_http(
    State(state): State<Arc<Mutex<RelayState>>>,
    uri: axum::http::Uri,
    method: Method,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let Some(device_id) = device_from_cookie(&headers) else {
        return (StatusCode::BAD_REQUEST, "device cookie required").into_response();
    };
    let path_and_query = match uri.query() {
        Some(query) => format!("{}?{query}", uri.path()),
        None => uri.path().to_string(),
    };
    proxy_to_desktop(
        &state,
        &device_id,
        &path_and_query,
        &method,
        &headers,
        &body,
    )
    .await
}

async fn proxy_to_desktop(
    state: &Arc<Mutex<RelayState>>,
    device_id: &str,
    path: &str,
    method: &Method,
    headers: &HeaderMap,
    body: &[u8],
) -> Response {
    let desktop_tx = state
        .lock()
        .expect("relay state poisoned")
        .desktops
        .get(device_id)
        .cloned();
    let Some(desktop_tx) = desktop_tx else {
        return (StatusCode::SERVICE_UNAVAILABLE, "desktop_offline").into_response();
    };
    let rid = {
        let mut state = state.lock().expect("relay state poisoned");
        state.next_rid += 1;
        state.next_rid
    };
    let (response_tx, response_rx) = oneshot::channel::<HttpResponseData>();
    state
        .lock()
        .expect("relay state poisoned")
        .http_pending
        .insert(rid, response_tx);
    let forwarded_headers: Vec<(String, String)> = headers
        .iter()
        .filter(|(name, _)| *name != header::HOST && *name != header::COOKIE)
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_string(), value.to_string()))
        })
        .collect();
    let frame = RelayFrame::Http {
        rid,
        method: method.to_string(),
        path: path.to_string(),
        headers: forwarded_headers,
        body: base64::engine::general_purpose::STANDARD.encode(body),
    };
    let under_quota = {
        let mut state = state.lock().expect("relay state poisoned");
        record_usage(&mut state, device_id, body.len() as u64)
    };
    if !under_quota {
        state
            .lock()
            .expect("relay state poisoned")
            .http_pending
            .remove(&rid);
        return (StatusCode::TOO_MANY_REQUESTS, "device byte quota exceeded").into_response();
    }
    if desktop_tx.send(frame).is_err() {
        state
            .lock()
            .expect("relay state poisoned")
            .http_pending
            .remove(&rid);
        return (StatusCode::SERVICE_UNAVAILABLE, "desktop_offline").into_response();
    }
    match tokio::time::timeout(HTTP_PROXY_TIMEOUT, response_rx).await {
        Ok(Ok(response)) => {
            let is_html = response.headers.iter().any(|(name, value)| {
                name.eq_ignore_ascii_case("content-type") && value.contains("text/html")
            });
            let mut builder = Response::builder().status(response.status);
            let mut body_bytes = base64::engine::general_purpose::STANDARD
                .decode(&response.body)
                .unwrap_or_default();
            if is_html {
                // The PWA manifest link is root-relative (`manifest.json`),
                // which the browser fetches without the device cookie and the
                // relay cannot route. Point it at the device-scoped path.
                if let Ok(html) = String::from_utf8(body_bytes.clone()) {
                    body_bytes = html
                        .replace(
                            r#"href="manifest.json""#,
                            &format!(r#"href="/d/{device_id}/manifest.json""#),
                        )
                        .into_bytes();
                }
            } else if path.ends_with("manifest.json") {
                if let Some(rewritten) = rewrite_manifest(&body_bytes, device_id) {
                    body_bytes = rewritten;
                }
            }
            for (name, value) in response.headers {
                if name.eq_ignore_ascii_case("content-length") {
                    continue;
                }
                if let Ok(value) = HeaderValue::from_str(&value) {
                    builder = builder.header(name, value);
                }
            }
            let under_quota = {
                let mut state = state.lock().expect("relay state poisoned");
                record_usage(&mut state, device_id, body_bytes.len() as u64)
            };
            if !under_quota {
                return (StatusCode::TOO_MANY_REQUESTS, "device byte quota exceeded")
                    .into_response();
            }
            builder
                .body(Body::from(body_bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Ok(Err(_)) | Err(_) => {
            state
                .lock()
                .expect("relay state poisoned")
                .http_pending
                .remove(&rid);
            (StatusCode::GATEWAY_TIMEOUT, "desktop_timeout").into_response()
        }
    }
}

/// Make the PWA manifest device-scoped when served through the relay: the
/// desktop's manifest uses root-absolute `start_url`/`scope`/`id`, which would
/// launch the installed app at the relay root (400). Rewrite them to the
/// device page path so "Add to Home Screen" works in relay mode. Returns
/// `None` when the body is not the JSON manifest.
fn rewrite_manifest(body: &[u8], device_id: &str) -> Option<Vec<u8>> {
    let mut manifest: serde_json::Value = serde_json::from_slice(body).ok()?;
    let base = format!("/d/{device_id}/app/");
    for key in ["start_url", "scope", "id"] {
        if manifest.get_mut(key).is_some() {
            manifest[key] = serde_json::Value::String(base.clone());
        }
    }
    serde_json::to_vec(&manifest).ok()
}

fn device_from_cookie(headers: &HeaderMap) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        if name.trim() != COOKIE_NAME {
            return None;
        }
        let value = value.trim().trim_matches('"');
        if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        }
    })
}

fn close_session(state: &Arc<Mutex<RelayState>>, sid: &str, reason: Option<String>) {
    let session = state
        .lock()
        .expect("relay state poisoned")
        .sessions
        .remove(sid);
    if let Some(session) = session {
        if let Some(reason) = reason {
            let _ = session.mobile_tx.send(Message::Text(reason.into()));
        }
        let _ = session.mobile_tx.send(Message::Close(None));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Message as ClientMessage;
    use tokio_tungstenite::MaybeTlsStream;

    async fn spawn_relay() -> std::net::SocketAddr {
        spawn_relay_with(None, None, None).await
    }

    async fn spawn_relay_with(
        registration_token: Option<&str>,
        session_cap: Option<usize>,
        byte_quota: Option<u64>,
    ) -> std::net::SocketAddr {
        let mut relay_state = RelayState::default();
        relay_state.registration_token = registration_token.map(str::to_owned);
        if let Some(cap) = session_cap {
            relay_state.session_cap_per_device = cap;
        }
        relay_state.byte_quota_per_device = byte_quota;
        let state = Arc::new(Mutex::new(relay_state));
        let app = relay_router(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap();
        });
        address
    }

    async fn connect_ws(
        url: &str,
    ) -> tokio_tungstenite::WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>> {
        let (socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
        socket
    }

    async fn next_text(
        socket: &mut tokio_tungstenite::WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
    ) -> String {
        loop {
            match socket.next().await.unwrap().unwrap() {
                ClientMessage::Text(text) => return text,
                _ => continue,
            }
        }
    }

    async fn register_desktop(
        base: &std::net::SocketAddr,
        device_id: &str,
    ) -> tokio_tungstenite::WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>> {
        let mut socket = connect_ws(&format!("ws://{base}/relay/desktop")).await;
        socket
            .send(ClientMessage::Text(
                RelayFrame::Hello {
                    device_id: device_id.into(),
                    kind: "desktop".into(),
                    registration_token: None,
                }
                .to_json(),
            ))
            .await
            .unwrap();
        let welcome = next_text(&mut socket).await;
        assert!(welcome.contains("\"type\":\"welcome\""));
        socket
    }

    async fn register_desktop_with_token(
        base: &std::net::SocketAddr,
        device_id: &str,
        registration_token: Option<&str>,
    ) -> tokio_tungstenite::WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>> {
        let mut socket = connect_ws(&format!("ws://{base}/relay/desktop")).await;
        socket
            .send(ClientMessage::Text(
                RelayFrame::Hello {
                    device_id: device_id.into(),
                    kind: "desktop".into(),
                    registration_token: registration_token.map(str::to_owned),
                }
                .to_json(),
            ))
            .await
            .unwrap();
        let response = next_text(&mut socket).await;
        assert!(response.contains("\"type\":\"welcome\""));
        socket
    }

    async fn register_desktop_expect_rejected(
        base: &std::net::SocketAddr,
        device_id: &str,
        registration_token: Option<&str>,
    ) -> String {
        let mut socket = connect_ws(&format!("ws://{base}/relay/desktop")).await;
        socket
            .send(ClientMessage::Text(
                RelayFrame::Hello {
                    device_id: device_id.into(),
                    kind: "desktop".into(),
                    registration_token: registration_token.map(str::to_owned),
                }
                .to_json(),
            ))
            .await
            .unwrap();
        next_text(&mut socket).await
    }

    async fn connect_mobile_ws(
        base: &std::net::SocketAddr,
        device_id: &str,
    ) -> tokio_tungstenite::WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>> {
        let mut request = format!("ws://{base}/v2/ws").into_client_request().unwrap();
        request.headers_mut().insert(
            header::COOKIE,
            HeaderValue::from_str(&format!("{COOKIE_NAME}={device_id}")).unwrap(),
        );
        let (socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
        socket
    }

    #[tokio::test]
    async fn proxies_http_through_a_registered_desktop() {
        let base = spawn_relay().await;
        let mut desktop = register_desktop(&base, "dev-http").await;
        let relay_task = tokio::spawn(async move {
            loop {
                let frame = RelayFrame::parse(&next_text(&mut desktop).await).unwrap();
                if let RelayFrame::Http { rid, path, .. } = frame {
                    desktop
                        .send(ClientMessage::Text(
                            RelayFrame::HttpResp {
                                rid,
                                status: 200,
                                headers: vec![("content-type".into(), "application/json".into())],
                                body: base64::engine::general_purpose::STANDARD
                                    .encode(format!("ok:{path}")),
                            }
                            .to_json(),
                        ))
                        .await
                        .unwrap();
                }
            }
        });

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("http://{base}/v2/bootstrap?name=session"))
            .header(header::COOKIE, "device=dev-http")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.text().await.unwrap(),
            "ok:/v2/bootstrap?name=session"
        );
        relay_task.abort();
    }

    #[tokio::test]
    async fn bridges_a_mobile_websocket_to_the_desktop_and_back() {
        let base = spawn_relay().await;
        let mut desktop = register_desktop(&base, "dev-ws").await;
        let desktop_task = tokio::spawn(async move {
            let frame = RelayFrame::parse(&next_text(&mut desktop).await).unwrap();
            let RelayFrame::SessionOpen { sid } = frame else {
                panic!("expected session_open, got {frame:?}");
            };
            desktop
                .send(ClientMessage::Text(
                    RelayFrame::SessionReady { sid: sid.clone() }.to_json(),
                ))
                .await
                .unwrap();
            let frame = RelayFrame::parse(&next_text(&mut desktop).await).unwrap();
            let RelayFrame::WsFrame {
                sid: got_sid,
                payload,
                binary,
            } = frame
            else {
                panic!("expected ws_frame, got {frame:?}");
            };
            assert_eq!(got_sid, sid);
            assert!(!binary);
            assert_eq!(payload, "mobile says hi");
            desktop
                .send(ClientMessage::Text(
                    RelayFrame::WsFrame {
                        sid,
                        payload: "desktop says hello".into(),
                        binary: false,
                    }
                    .to_json(),
                ))
                .await
                .unwrap();
        });

        let mut mobile = connect_mobile_ws(&base, "dev-ws").await;
        mobile
            .send(ClientMessage::Text("mobile says hi".into()))
            .await
            .unwrap();
        let echoed = next_text(&mut mobile).await;
        assert_eq!(echoed, "desktop says hello");
        desktop_task.await.unwrap();
        mobile.close(None).await.unwrap();
    }

    #[tokio::test]
    async fn signals_desktop_offline_when_no_desktop_is_registered() {
        let base = spawn_relay().await;
        let mut mobile = connect_mobile_ws(&base, "ghost-desktop").await;
        let first = next_text(&mut mobile).await;
        assert!(
            first.contains("desktop_offline"),
            "expected a desktop_offline frame, got: {first}"
        );
        let closed = mobile.next().await;
        assert!(
            matches!(closed, Some(Ok(ClientMessage::Close(_)))),
            "relay should close the mobile socket after desktop_offline"
        );
    }

    #[test]
    fn rewrites_manifest_urls_to_the_device_scope() {
        let manifest = br#"{"name":"ZiCode","start_url":"/","scope":"/","id":"/","icons":[{"src":"icons/favicon.svg"}]}"#;
        let rewritten = rewrite_manifest(manifest, "dev-ax2-01").unwrap();
        let value: serde_json::Value = serde_json::from_slice(&rewritten).unwrap();
        assert_eq!(value["start_url"], "/d/dev-ax2-01/app/");
        assert_eq!(value["scope"], "/d/dev-ax2-01/app/");
        assert_eq!(value["id"], "/d/dev-ax2-01/app/");
        assert_eq!(value["name"], "ZiCode");

        // Non-JSON bodies (e.g. the SPA fallback HTML) are left untouched.
        assert!(rewrite_manifest(b"<html></html>", "dev").is_none());
    }

    #[tokio::test]
    async fn redirects_device_scoped_app_urls_to_root_paths_with_a_cookie() {
        let base = spawn_relay().await;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let response = client
            .get(format!(
                "http://{base}/d/dev-1/app/workspaces/w/sessions/s?pairingToken=x"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(
            response
                .headers()
                .get(header::LOCATION)
                .unwrap()
                .to_str()
                .unwrap(),
            "/app/workspaces/w/sessions/s?pairingToken=x"
        );
        assert!(response
            .headers()
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("device=dev-1"));
    }

    #[tokio::test]
    async fn rejects_registrations_without_a_configured_token() {
        let base = spawn_relay_with(Some("s3cret"), None, None).await;

        let without = register_desktop_expect_rejected(&base, "dev-no-token", None).await;
        assert!(without.contains("token rejected"));
        let wrong = register_desktop_expect_rejected(&base, "dev-wrong", Some("nope")).await;
        assert!(wrong.contains("token rejected"));

        let _accepted = register_desktop_with_token(&base, "dev-ok", Some("s3cret")).await;
    }

    #[tokio::test]
    async fn accepts_open_registration_when_no_token_is_configured() {
        let base = spawn_relay().await;
        let _desktop = register_desktop(&base, "dev-open").await;
    }

    #[tokio::test]
    async fn rejects_malformed_device_ids() {
        let base = spawn_relay().await;

        let spaced = register_desktop_expect_rejected(&base, "bad id!", None).await;
        assert!(spaced.contains("invalid device id"));
        let empty = register_desktop_expect_rejected(&base, "", None).await;
        assert!(empty.contains("invalid device id"));
        let too_long =
            register_desktop_expect_rejected(&base, &"d".repeat(MAX_DEVICE_ID_LENGTH + 1), None)
                .await;
        assert!(too_long.contains("invalid device id"));
    }

    #[tokio::test]
    async fn rate_limits_registrations_per_source_ip() {
        let mut relay_state = RelayState::default();
        relay_state.registration_max_per_window = 3;
        let state = Arc::new(Mutex::new(relay_state));
        let app = relay_router(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap();
        });

        for index in 0..3 {
            let _desktop = register_desktop(&base, &format!("dev-rate-{index}")).await;
        }
        let response = register_desktop_expect_rejected(&base, "dev-rate-limited", None).await;
        assert!(response.contains("rate limited"));
    }

    #[tokio::test]
    async fn caps_concurrent_mobile_sessions_per_device() {
        let base = spawn_relay_with(None, Some(2), None).await;
        let _desktop = register_desktop(&base, "dev-cap").await;
        let _first = connect_mobile_ws(&base, "dev-cap").await;
        let _second = connect_mobile_ws(&base, "dev-cap").await;

        let mut request = format!("ws://{base}/v2/ws").into_client_request().unwrap();
        request.headers_mut().insert(
            header::COOKIE,
            HeaderValue::from_str("device=dev-cap").unwrap(),
        );
        assert!(tokio_tungstenite::connect_async(request).await.is_err());
    }

    #[tokio::test]
    async fn enforces_http_byte_quota_and_exposes_usage() {
        let base = spawn_relay_with(None, None, Some(1)).await;
        let mut desktop = register_desktop(&base, "dev-quota-http").await;
        let relay_task = tokio::spawn(async move {
            loop {
                let frame = RelayFrame::parse(&next_text(&mut desktop).await).unwrap();
                if let RelayFrame::Http { rid, path, .. } = frame {
                    desktop
                        .send(ClientMessage::Text(
                            RelayFrame::HttpResp {
                                rid,
                                status: 200,
                                headers: vec![("content-type".into(), "text/plain".into())],
                                body: base64::engine::general_purpose::STANDARD
                                    .encode(format!("ok:{path}")),
                            }
                            .to_json(),
                        ))
                        .await
                        .unwrap();
                }
            }
        });

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("http://{base}/v2/bootstrap?name=session"))
            .header(header::COOKIE, "device=dev-quota-http")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);

        let status: serde_json::Value = client
            .get(format!("http://{base}/relay/status"))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let usage = status["usage"].as_array().unwrap();
        assert!(
            usage
                .iter()
                .any(|entry| entry[0] == "dev-quota-http" && entry[1].as_u64().unwrap_or(0) > 0),
            "usage should include the device's relayed bytes"
        );
        relay_task.abort();
    }

    #[tokio::test]
    async fn enforces_websocket_byte_quota() {
        let base = spawn_relay_with(None, None, Some(20)).await;
        let mut desktop = register_desktop(&base, "dev-quota-ws").await;
        let desktop_task = tokio::spawn(async move {
            loop {
                let frame = RelayFrame::parse(&next_text(&mut desktop).await).unwrap();
                if let RelayFrame::WsFrame {
                    sid,
                    payload,
                    binary,
                } = frame
                {
                    desktop
                        .send(ClientMessage::Text(
                            RelayFrame::WsFrame {
                                sid,
                                payload,
                                binary,
                            }
                            .to_json(),
                        ))
                        .await
                        .unwrap();
                }
            }
        });

        let mut mobile = connect_mobile_ws(&base, "dev-quota-ws").await;
        mobile
            .send(ClientMessage::Text("x".repeat(64).into()))
            .await
            .unwrap();
        let reply = next_text(&mut mobile).await;
        assert!(reply.contains("device_quota_exceeded"));
        desktop_task.abort();
    }

    #[test]
    fn resets_usage_at_the_start_of_a_new_day() {
        let mut state = RelayState::default();
        state.byte_quota_per_device = Some(500);
        let now = unix_now();
        let yesterday = now - 86400;
        state.usage.insert(
            "dev-day".into(),
            DeviceUsage {
                bytes: 1000,
                updated_at: yesterday,
                day: day_of(yesterday),
            },
        );

        // Yesterday's counter alone would exceed the quota; the new day
        // resets it before adding.
        assert!(record_usage_at(&mut state, "dev-day", 1, now));
        assert_eq!(state.usage["dev-day"].bytes, 1);
        assert_eq!(state.usage["dev-day"].day, day_of(now));
    }
}
