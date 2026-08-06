#![cfg_attr(not(test), allow(dead_code))]

use crate::artifact_store::{ArtifactDraft, ArtifactError, ArtifactStore};
use crate::host_data::{HostDataError, HostDataPlane};
use crate::host_router::{HostRouter, RoutedAction, PROTOCOL_VERSION};
use crate::native_pi_manager::{NativeLaunchSpec, NativePiManager};
use crate::notes_vault::{content_hash, now_iso, NoteSource, NotesError, NotesVault, VaultExport};
use crate::pi_launch::{list_installed_apps, open_external, open_in_app, PiLaunchResolver};
use crate::plugin_capabilities::{CapabilityBroker, CapabilityError, CapabilityInvocation};
use crate::plugin_package::SignedPluginPreview;
use crate::plugin_registry::PluginRegistry;
use crate::relay_client::{page_origin_of, RelayAgentConfig, RelayAgentState, RelayAgentStatus};
use crate::remote_auth::{PairingError, RemoteAuth};
use crate::remote_tls::PreparedRemoteTlsListener;
use crate::runtime_coordinator::{RuntimeStatus, RuntimeTarget};
use axum::body::Body;
use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, DefaultBodyLimit, Json, Request, State};
use axum::extract::{Path, Query};
use axum::http::header::{CACHE_CONTROL, PRAGMA};
use axum::http::HeaderValue;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::Router;
use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::collections::HashSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tower::ServiceBuilder;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

const MAX_HTTP_BODY_BYTES: usize = 2 * 1024 * 1024;
const QVERIS_GATEWAY_TARGET: &str = "https://aigateway.qveris.ai/v1";
const MAX_ATTACHMENT_HTTP_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_BACKUP_HTTP_BODY_BYTES: usize = 70 * 1024 * 1024;
const MAX_WS_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const PLUGIN_BROKER_TOKEN_TTL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone)]
struct RuntimePluginToken {
    token_hash: String,
    target: RuntimeTarget,
    expires_at: SystemTime,
}

#[derive(Clone, Default)]
struct RemoteAccessRuntime {
    running: bool,
    urls: Vec<String>,
    enrollment_urls: Vec<String>,
    ca_certificate_pem: String,
    ca_fingerprint: String,
    relay_status: RelayAgentStatus,
    e2ee_identity: Option<crate::e2ee::E2eeIdentityRef>,
}

struct HostState {
    router: Mutex<HostRouter>,
    runtimes: NativePiManager,
    auth: Arc<Mutex<RemoteAuth>>,
    session_owners: Mutex<std::collections::HashMap<RuntimeTarget, String>>,
    data: HostDataPlane,
    plugins: Mutex<PluginRegistry>,
    capability_broker: Mutex<CapabilityBroker>,
    notes: Mutex<NotesVault>,
    artifacts: Mutex<ArtifactStore>,
    plugin_tokens: Mutex<HashMap<String, RuntimePluginToken>>,
    pi_launch: PiLaunchResolver,
    allowed_origin: String,
    allowed_origins: HashSet<String>,
    remote_access: RemoteAccessRuntime,
}

pub struct HostServer {
    origin: String,
    shutdown: Option<oneshot::Sender<()>>,
    lan_shutdown: Option<axum_server::Handle<SocketAddr>>,
    enrollment_shutdown: Option<oneshot::Sender<()>>,
    public_shutdown: Option<axum_server::Handle<SocketAddr>>,
    relay_shutdown: Option<oneshot::Sender<()>>,
    state: Arc<HostState>,
}

impl HostServer {
    pub fn notes_vault(&self) -> Result<NotesVault, String> {
        self.state
            .notes
            .lock()
            .map(|vault| vault.clone())
            .map_err(|_| "Notes vault is unavailable".to_string())
    }

    pub async fn start(
        static_dir: PathBuf,
        runtimes: NativePiManager,
        auth: Arc<Mutex<RemoteAuth>>,
    ) -> Result<Self, String> {
        Self::start_with_workspaces(static_dir, runtimes, auth, HashMap::new()).await
    }

    pub async fn start_with_workspaces(
        static_dir: PathBuf,
        runtimes: NativePiManager,
        auth: Arc<Mutex<RemoteAuth>>,
        workspace_roots: HashMap<String, PathBuf>,
    ) -> Result<Self, String> {
        let mut data = HostDataPlane::new(workspace_roots)
            .map_err(|error| format!("Cannot initialize Host data plane: {error:?}"))?;
        if let Ok(data_root) = crate::app_paths::data_root() {
            data = data
                .with_session_root(data_root.join("instances"))
                .with_session_root(data_root.join("sessions"));
        }
        // Prefer a stable, high, rarely-used loopback port. The desktop Host
        // exposes workspace and runtime control endpoints, so it must never be
        // reachable from the LAN unless a future authenticated LAN gateway is
        // enabled explicitly.
        const PREFERRED_PORT_BASE: u16 = 57620;
        const PREFERRED_PORT_COUNT: u16 = 32;
        let mut listener = None;
        for offset in 0..PREFERRED_PORT_COUNT {
            let candidate = PREFERRED_PORT_BASE + offset;
            if let Ok(bound) =
                tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, candidate)).await
            {
                listener = Some(bound);
                break;
            }
        }
        let listener = match listener {
            Some(listener) => listener,
            None => tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .map_err(|error| format!("Cannot bind ZiCode Studio Desktop Host: {error}"))?,
        };
        let address = listener
            .local_addr()
            .map_err(|error| format!("Cannot read ZiCode Studio Desktop Host address: {error}"))?;
        let loopback_origin = format!("http://127.0.0.1:{}", address.port());
        let remote_access_enabled = configured_remote_access_enabled()?;
        let prepared_remote = if remote_access_enabled {
            Some(crate::remote_tls::prepare_lan_listener().await?)
        } else {
            None
        };
        let mut allowed_origins = HashSet::from([loopback_origin.clone()]);
        if let Some(prepared) = &prepared_remote {
            allowed_origins.extend(prepared.urls.iter().cloned());
        }
        let remote_access_config = crate::remote_access_config::load().unwrap_or_default();
        if remote_access_config.relay_enabled {
            if let Some(origin) = remote_access_config
                .public_url
                .as_deref()
                .and_then(page_origin_of)
            {
                allowed_origins.insert(origin);
            }
        }
        #[cfg(test)]
        let plugin_root = static_dir
            .parent()
            .unwrap_or(&static_dir)
            .join("test-plugin-registry");
        #[cfg(not(test))]
        let plugin_root = crate::app_paths::plugins_root()?;
        let plugins = PluginRegistry::open(plugin_root.clone())
            .map_err(|error| format!("Cannot initialize application plugin registry: {error}"))?;
        let notes = NotesVault::new(plugin_root.clone())
            .map_err(|error| format!("Cannot initialize Notes vault: {error}"))?;
        let artifacts = ArtifactStore::new(plugin_root.clone())
            .map_err(|error| format!("Cannot initialize Artifacts store: {error}"))?;
        let capability_broker = CapabilityBroker::new(plugin_root)
            .map_err(|error| format!("Cannot initialize plugin capability broker: {error}"))?;
        let relay_status: RelayAgentStatus = Arc::new(Mutex::new(RelayAgentState::default()));
        let e2ee_identity = match crate::e2ee::E2eeIdentity::load_or_create() {
            Ok(identity) => Some(Arc::new(identity)),
            Err(error) => {
                log::warn!(
                    "[e2ee] E2EE identity unavailable; relay sessions stay in M1 mode: {error}"
                );
                None
            }
        };
        let remote_access = prepared_remote
            .as_ref()
            .map(|prepared| RemoteAccessRuntime {
                running: true,
                urls: prepared.urls.clone(),
                enrollment_urls: prepared.enrollment_urls.clone(),
                ca_certificate_pem: prepared.ca_certificate_pem.clone(),
                ca_fingerprint: prepared.ca_fingerprint.clone(),
                relay_status: relay_status.clone(),
                e2ee_identity: e2ee_identity.clone(),
            })
            .unwrap_or_default();
        // Poll the relay's public status endpoint so the settings panel can
        // show this device's current-day relayed bytes next to the daily
        // quota. Failure-tolerant: usage stays unknown when unreachable.
        if remote_access_config.relay_enabled {
            if let (Some(relay_url), Some(relay_device_id)) = (
                remote_access_config.relay_url.clone(),
                remote_access_config.relay_device_id.clone(),
            ) {
                let poll_status = relay_status.clone();
                tokio::spawn(async move {
                    let client = reqwest::Client::builder()
                        .no_proxy()
                        .timeout(Duration::from_secs(10))
                        .build()
                        .unwrap_or_default();
                    loop {
                        let (bytes, history) =
                            match crate::relay_client::relay_status_base(&relay_url) {
                                Some(base) => {
                                    let url = format!("{base}/relay/status");
                                    match client.get(&url).send().await {
                                        Ok(response) => match response.text().await {
                                            Ok(body) => (
                                                crate::relay_client::parse_relay_usage(
                                                    &body,
                                                    &relay_device_id,
                                                ),
                                                crate::relay_client::parse_relay_usage_history(
                                                    &body,
                                                    &relay_device_id,
                                                ),
                                            ),
                                            Err(_) => (None, Vec::new()),
                                        },
                                        Err(_) => (None, Vec::new()),
                                    }
                                }
                                None => (None, Vec::new()),
                            };
                        if let Ok(mut status) = poll_status.lock() {
                            status.usage_bytes = bytes;
                            status.usage_history = history;
                        }
                        tokio::time::sleep(Duration::from_secs(30)).await;
                    }
                });
            }
        }
        let relay_shutdown =
            prepare_relay_agent(prepared_remote.as_ref(), relay_status, e2ee_identity)?;
        let state = Arc::new(HostState {
            router: Mutex::new(HostRouter::new()),
            runtimes,
            auth,
            session_owners: Mutex::new(std::collections::HashMap::new()),
            data,
            plugins: Mutex::new(plugins),
            capability_broker: Mutex::new(capability_broker),
            notes: Mutex::new(notes),
            artifacts: Mutex::new(artifacts),
            plugin_tokens: Mutex::new(HashMap::new()),
            pi_launch: PiLaunchResolver::new(static_dir.clone()),
            allowed_origin: loopback_origin.clone(),
            allowed_origins,
            remote_access,
        });
        let index = static_dir.join("index.html");
        let static_service = ServeDir::new(static_dir).fallback(ServeFile::new(index));
        // Release builds must revalidate static assets too: without Cache-Control,
        // WebView2 and mobile browsers fall back to heuristic caching and keep
        // serving the previous build's JS/CSS after an update. Revalidation is
        // cheap against a local server and guarantees users see the current UI.
        let static_service = ServiceBuilder::new()
            .layer(SetResponseHeaderLayer::overriding(
                CACHE_CONTROL,
                HeaderValue::from_static("no-store, no-cache, must-revalidate, max-age=0"),
            ))
            .layer(SetResponseHeaderLayer::overriding(
                PRAGMA,
                HeaderValue::from_static("no-cache"),
            ))
            .service(static_service);
        let base = Router::new()
            .route("/health", get(health))
            .route("/v2/bootstrap", get(bootstrap_target))
            .route("/v2/remote-config", get(remote_config))
            .route("/v2/sessions", get(list_all_sessions_http))
            .route("/v2/plugins", get(list_plugins))
            .route("/v2/plugins/enablement", post(set_plugin_enablement))
            .route("/v2/plugins/permission", post(set_plugin_permission))
            .route("/v2/plugins/reload", post(reload_plugins))
            .route("/v2/plugins/uninstall", post(uninstall_plugin))
            .route("/v2/plugin-views/source", get(read_plugin_view_source))
            .route("/v2/plugin-capabilities", get(list_plugin_capabilities))
            .route(
                "/v2/plugin-capabilities/invoke",
                post(invoke_plugin_capability),
            )
            .route("/v2/plugin-commands/invoke", post(invoke_plugin_command))
            .route("/v2/plugin-tools/invoke", post(invoke_plugin_tool))
            .route("/v2/notes", get(list_notes))
            .route("/v2/notes/knowledge", get(list_note_knowledge))
            .route("/v2/notes/changes", get(list_note_changes))
            .route("/v2/notes/notebooks", post(create_notebook))
            .route("/v2/notes/notebooks/update", post(update_notebook))
            .route("/v2/notes/note", get(get_note))
            .route("/v2/notes/create", post(create_note))
            .route("/v2/notes/save", post(save_note))
            .route("/v2/notes/delete", post(delete_note))
            .route("/v2/notes/capture", post(capture_note))
            .route(
                "/v2/notes/attachments",
                post(upload_note_attachment)
                    .layer(DefaultBodyLimit::max(MAX_ATTACHMENT_HTTP_BODY_BYTES)),
            )
            .route("/v2/notes/attachment", get(read_note_attachment))
            .route("/v2/notes/import-markdown", post(import_markdown_note))
            .route("/v2/notes/export", get(export_notes_backup))
            .route(
                "/v2/notes/import-backup",
                post(import_notes_backup).layer(DefaultBodyLimit::max(MAX_BACKUP_HTTP_BODY_BYTES)),
            )
            .route("/v2/notes/rebuild", post(rebuild_notes_index))
            .route("/v2/artifacts", get(list_artifacts))
            .route("/v2/artifacts/item", get(get_artifact))
            .route("/v2/artifacts/create", post(create_artifact))
            .route("/v2/artifacts/delete", post(delete_artifact))
            .route("/v2/auth/exchange", post(exchange_pairing))
            .route("/v2/auth/ca.pem", get(download_remote_ca))
            .route("/v2/lan-qr", get(lan_qr))
            .route("/v2/model-gateway/{*path}", any(model_gateway_proxy))
            .route("/v2/new-session", post(new_session))
            .route("/v2/resolve-workspace", post(resolve_workspace))
            .fallback_service(static_service);

        let app = base
            .clone()
            .route("/v2/ws", get(websocket_upgrade))
            .layer(middleware::from_fn_with_state(
                state.clone(),
                authorize_remote_http,
            ))
            .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
            .with_state(state.clone());

        // The public gateway is served with strict device authentication: it
        // never trusts the loopback peer (a frp tunnel arrives from 127.0.0.1)
        // and it hides desktop-only endpoints (pairing issuance, the local
        // model gateway). Public mobile clients must pair like LAN clients.
        let public_app = if prepared_remote
            .as_ref()
            .and_then(|prepared| prepared.public_listener.as_ref())
            .is_some()
        {
            Some(
                base.route("/v2/ws", get(websocket_upgrade_public))
                    .layer(middleware::from_fn_with_state(
                        state.clone(),
                        authorize_public_http,
                    ))
                    .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
                    .with_state(state.clone()),
            )
        } else {
            None
        };

        let (lan_shutdown, enrollment_shutdown, public_shutdown) = if let Some(prepared) =
            prepared_remote
        {
            let handle = axum_server::Handle::new();
            let server_handle = handle.clone();
            let lan_app = app.clone();
            let tls_config = prepared.tls_config.clone();
            let public_listener = prepared.public_listener;
            let enrollment_listener =
                tokio::net::TcpListener::from_std(prepared.enrollment_listener)
                    .map_err(|error| format!("Cannot start mobile setup listener: {error}"))?;
            let enrollment_app = crate::remote_enrollment::router(
                prepared.ca_certificate_pem.clone(),
                prepared.ca_fingerprint.clone(),
            );
            let (enrollment_tx, enrollment_rx) = oneshot::channel();
            tokio::spawn(async move {
                if let Err(error) = axum::serve(enrollment_listener, enrollment_app)
                    .with_graceful_shutdown(async {
                        let _ = enrollment_rx.await;
                    })
                    .await
                {
                    log::error!("[picot-host] mobile setup server stopped unexpectedly: {error}");
                }
            });
            tokio::spawn(async move {
                let server = match axum_server::from_tcp_rustls(prepared.listener, tls_config) {
                    Ok(server) => server,
                    Err(error) => {
                        log::error!("[picot-host] cannot start secure mobile server: {error}");
                        return;
                    }
                };
                if let Err(error) = server
                    .handle(server_handle)
                    .serve(lan_app.into_make_service_with_connect_info::<SocketAddr>())
                    .await
                {
                    log::error!("[picot-host] secure mobile server stopped unexpectedly: {error}");
                }
            });
            let public_shutdown = match (public_listener, public_app) {
                (Some(listener), Some(public_app)) => {
                    let handle = axum_server::Handle::new();
                    let server_handle = handle.clone();
                    let public_tls_config = prepared.tls_config.clone();
                    tokio::spawn(async move {
                        let server = match axum_server::from_tcp_rustls(listener, public_tls_config)
                        {
                            Ok(server) => server,
                            Err(error) => {
                                log::error!(
                                    "[picot-host] cannot start public mobile server: {error}"
                                );
                                return;
                            }
                        };
                        if let Err(error) = server
                            .handle(server_handle)
                            .serve(public_app.into_make_service_with_connect_info::<SocketAddr>())
                            .await
                        {
                            log::error!(
                                "[picot-host] public mobile server stopped unexpectedly: {error}"
                            );
                        }
                    });
                    Some(handle)
                }
                _ => None,
            };
            (Some(handle), Some(enrollment_tx), public_shutdown)
        } else {
            (None, None, None)
        };
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(async move {
            if let Err(error) = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            {
                log::error!("[picot-host] server stopped unexpectedly: {error}");
            }
        });
        Ok(Self {
            origin: loopback_origin,
            shutdown: Some(shutdown_tx),
            lan_shutdown,
            enrollment_shutdown,
            public_shutdown,
            relay_shutdown,
            state,
        })
    }

    /// Register a workspace root at runtime so its files, sessions, and cost
    /// data become reachable over the data plane. Used when opening a new
    /// folder as a workspace after startup.
    pub fn register_workspace(&self, workspace_id: &str, root: PathBuf) -> Result<(), String> {
        self.state
            .data
            .register_workspace(workspace_id, root)
            .map_err(|error| format!("Cannot register workspace: {error:?}"))
    }

    pub fn scene_id_for_session(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<Option<String>, String> {
        self.state
            .data
            .scene_id_for_session(workspace_id, session_id)
            .map_err(|error| format!("Cannot resolve session scene: {error:?}"))
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub fn configure_plugin_broker(
        &self,
        target: &RuntimeTarget,
        launch: &mut NativeLaunchSpec,
    ) -> Result<(), String> {
        configure_plugin_broker_for_state(&self.state, target, launch)
    }

    pub fn install_developer_plugin(&self, source: &std::path::Path) -> Result<String, String> {
        self.state
            .plugins
            .lock()
            .map_err(|_| "Plugin registry is unavailable".to_string())?
            .install_developer(source)
    }

    pub fn preview_signed_plugin(
        &self,
        package: &std::path::Path,
    ) -> Result<SignedPluginPreview, String> {
        self.state
            .plugins
            .lock()
            .map_err(|_| "Plugin registry is unavailable".to_string())?
            .preview_signed(package)
    }

    pub fn install_signed_plugin(
        &self,
        package: &std::path::Path,
        trust_publisher: bool,
    ) -> Result<String, String> {
        self.state
            .plugins
            .lock()
            .map_err(|_| "Plugin registry is unavailable".to_string())?
            .install_signed(package, trust_publisher)
    }

    pub fn rollback_signed_plugin(&self, plugin_id: &str, version: &str) -> Result<(), String> {
        self.state
            .plugins
            .lock()
            .map_err(|_| "Plugin registry is unavailable".to_string())?
            .rollback_signed(plugin_id, version)
    }

    pub fn revoke_plugin_publisher(&self, key_id: &str) -> Result<(), String> {
        self.state
            .plugins
            .lock()
            .map_err(|_| "Plugin registry is unavailable".to_string())?
            .revoke_signed_publisher(key_id)
    }

    pub fn stop(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(handle) = self.lan_shutdown.take() {
            handle.graceful_shutdown(Some(Duration::from_secs(5)));
        }
        if let Some(shutdown) = self.enrollment_shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(handle) = self.public_shutdown.take() {
            handle.graceful_shutdown(Some(Duration::from_secs(5)));
        }
        if let Some(shutdown) = self.relay_shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

fn configure_plugin_broker_for_state(
    state: &HostState,
    target: &RuntimeTarget,
    launch: &mut NativeLaunchSpec,
) -> Result<(), String> {
    let tools = state
        .plugins
        .lock()
        .map_err(|_| "Plugin registry is unavailable".to_string())?
        .pi_tools(&target.scene_id);
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let token_hash = sha256_hex(token.as_bytes());
    let mut tokens = state
        .plugin_tokens
        .lock()
        .map_err(|_| "Plugin broker token store is unavailable".to_string())?;
    let now = SystemTime::now();
    tokens.retain(|_, record| record.expires_at > now);
    tokens.insert(
        target.instance_id.clone(),
        RuntimePluginToken {
            token_hash,
            target: target.clone(),
            expires_at: now + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    launch.environment.insert(
        "PI_DESKTOP_PLUGIN_HOST_ORIGIN".into(),
        state.allowed_origin.clone(),
    );
    launch
        .environment
        .insert("PI_DESKTOP_PLUGIN_BROKER_TOKEN".into(), token);
    launch.environment.insert(
        "PI_DESKTOP_PLUGIN_TOOLS".into(),
        serde_json::to_string(&tools)
            .map_err(|error| format!("Cannot encode plugin tool snapshot: {error}"))?,
    );
    launch.environment.insert(
        "PI_DESKTOP_PLUGIN_RUNTIME_ID".into(),
        target.instance_id.clone(),
    );
    launch.environment.insert(
        "PI_DESKTOP_PLUGIN_SESSION_ID".into(),
        target.session_id.clone(),
    );
    Ok(())
}

impl Drop for HostServer {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(handle) = self.lan_shutdown.take() {
            handle.graceful_shutdown(Some(Duration::from_secs(5)));
        }
        if let Some(shutdown) = self.enrollment_shutdown.take() {
            let _ = shutdown.send(());
        }
        if let Some(handle) = self.public_shutdown.take() {
            handle.graceful_shutdown(Some(Duration::from_secs(5)));
        }
        if let Some(shutdown) = self.relay_shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

async fn health(State(state): State<Arc<HostState>>) -> Json<Value> {
    let lan_url = state
        .remote_access
        .urls
        .first()
        .cloned()
        .unwrap_or_default();
    Json(json!({
        "status": "ok",
        "protocolVersion": PROTOCOL_VERSION,
        "piVersion": crate::pi_launch::locked_pi_version(),
        "lanUrl": lan_url,
        "lanAccessEnabled": state.remote_access.running,
    }))
}

#[cfg(test)]
fn configured_remote_access_enabled() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(test))]
fn configured_remote_access_enabled() -> Result<bool, String> {
    Ok(crate::remote_access_config::load()?.enabled)
}

fn prepare_relay_agent(
    prepared: Option<&PreparedRemoteTlsListener>,
    status: RelayAgentStatus,
    e2ee_identity: Option<crate::e2ee::E2eeIdentityRef>,
) -> Result<Option<oneshot::Sender<()>>, String> {
    let Some(prepared) = prepared else {
        return Ok(None);
    };
    let config = crate::remote_access_config::load()
        .map_err(|message| format!("Cannot load remote access settings: {message}"))?;
    if !config.relay_enabled {
        return Ok(None);
    }
    let relay_url = config
        .relay_url
        .ok_or("relay_url is required when relay access is enabled")?;
    let device_id = config
        .relay_device_id
        .ok_or("relay_device_id is required when relay access is enabled")?;
    let gateway_origin = prepared
        .public_listener
        .as_ref()
        .map(|listener| {
            listener
                .local_addr()
                .map(|address| format!("https://127.0.0.1:{}", address.port()))
        })
        .transpose()
        .map_err(|error| format!("Cannot read the public gateway address: {error}"))?
        .ok_or("A public gateway must be enabled before relay access (set publicUrl)")?;
    let page_origin = config
        .public_url
        .as_deref()
        .and_then(page_origin_of)
        .ok_or("publicUrl must be a valid https URL when relay access is enabled")?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    tokio::spawn(crate::relay_client::run(
        RelayAgentConfig {
            relay_url,
            device_id,
            gateway_origin,
            page_origin: page_origin.clone(),
            status,
            e2ee_identity,
            registration_token: config.relay_registration_token.clone(),
        },
        shutdown_rx,
    ));
    log::info!("[relay-agent] relay access enabled for {page_origin}");
    Ok(Some(shutdown_tx))
}

fn public_remote_path(path: &str) -> bool {
    matches!(
        path,
        "/health" | "/v2/ws" | "/v2/auth/exchange" | "/v2/auth/ca.pem"
    ) || !path.starts_with("/v2/")
}

fn remote_access_status_payload(
    state: &HostState,
    config: &crate::remote_access_config::RemoteAccessConfig,
    restart_required: bool,
    request_id: &str,
) -> serde_json::Value {
    let relay = state
        .remote_access
        .relay_status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default();
    json!({
        "type": "auth_response",
        "requestId": request_id,
        "configuredEnabled": config.enabled,
        "running": state.remote_access.running,
        "restartRequired": restart_required,
        "urls": state.remote_access.urls,
        "enrollmentUrls": state.remote_access.enrollment_urls,
        "caFingerprint": state.remote_access.ca_fingerprint,
        "publicUrl": config.public_url,
        "publicEnrollmentUrl": config.public_enrollment_url,
        "relayEnabled": config.relay_enabled,
        "relayUrl": config.relay_url,
        "relayDeviceId": config.relay_device_id,
        "relayTurnUrl": config.relay_turn_url,
        "relayTurnRealm": config.relay_turn_realm,
        "relayConnected": relay.connected,
        "relayConnectedAt": relay.connected_at,
        "relayLastError": relay.last_error,
        "relayUsageBytes": relay.usage_bytes,
        "relayUsageHistory": relay
            .usage_history
            .iter()
            .map(|entry| json!({ "day": entry.day, "bytes": entry.bytes }))
            .collect::<Vec<_>>(),
        "e2eePublicKey": state
            .remote_access
            .e2ee_identity
            .as_ref()
            .map(|identity| identity.public_key_base64()),
        "e2eeFingerprint": state
            .remote_access
            .e2ee_identity
            .as_ref()
            .map(|identity| identity.fingerprint()),
    })
}

async fn download_remote_ca(State(state): State<Arc<HostState>>) -> Response {
    if !state.remote_access.running || state.remote_access.ca_certificate_pem.is_empty() {
        return StatusCode::NOT_FOUND.into_response();
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, "application/x-pem-file")
        .header(
            axum::http::header::CONTENT_DISPOSITION,
            "attachment; filename=ZiCode-Studio-Mobile-CA.pem",
        )
        .body(Body::from(state.remote_access.ca_certificate_pem.clone()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn remote_http_authorized(
    auth: &Arc<Mutex<RemoteAuth>>,
    peer_ip: IpAddr,
    headers: &HeaderMap,
) -> bool {
    if peer_ip.is_loopback() {
        return true;
    }
    http_bearer_authorized(auth, headers)
}

fn http_bearer_authorized(auth: &Arc<Mutex<RemoteAuth>>, headers: &HeaderMap) -> bool {
    let Some(token) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    auth.lock()
        .ok()
        .and_then(|mut auth| auth.authorize(token).ok())
        .unwrap_or(false)
}

async fn authorize_remote_http(
    State(state): State<Arc<HostState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    if public_remote_path(request.uri().path())
        || remote_http_authorized(&state.auth, peer.ip(), request.headers())
    {
        return next.run(request).await;
    }
    api_error(StatusCode::UNAUTHORIZED, "device_auth_required").into_response()
}

/// Strict authentication for the public tunnel gateway. Unlike the LAN
/// server, a loopback peer is never trusted: every tunneled connection looks
/// like 127.0.0.1 to the desktop, so requests must present a valid device
/// token. Desktop-only endpoints (pairing issuance and the local model
/// gateway) are hidden entirely.
async fn authorize_public_http(
    State(state): State<Arc<HostState>>,
    request: Request,
    next: Next,
) -> Response {
    let path = request.uri().path();
    if path == "/v2/lan-qr" || path.starts_with("/v2/model-gateway/") {
        return api_error(StatusCode::FORBIDDEN, "desktop_only").into_response();
    }
    if public_remote_path(path) || http_bearer_authorized(&state.auth, request.headers()) {
        return next.run(request).await;
    }
    api_error(StatusCode::UNAUTHORIZED, "device_auth_required").into_response()
}

#[derive(Deserialize)]
struct LanQrQuery {
    path: Option<String>,
    kind: Option<String>,
}

async fn lan_qr(
    State(state): State<Arc<HostState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(query): Query<LanQrQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if !lan_qr_issuer_allowed(peer.ip()) {
        return Err(api_error(StatusCode::FORBIDDEN, "desktop_pairing_required"));
    }
    let kind = query.kind.as_deref().unwrap_or("session");
    if kind == "setup" {
        let Some(url) = state.remote_access.enrollment_urls.first() else {
            return Err(api_error(StatusCode::NOT_FOUND, "lan_access_disabled"));
        };
        return Ok(Json(json!({
            "kind": "setup",
            "url": url,
            "dataUrl": qr_data_url(url)?,
            "expiresAt": Value::Null,
            "caFingerprint": state.remote_access.ca_fingerprint,
        })));
    }
    if kind != "session" {
        return Err(api_error(StatusCode::BAD_REQUEST, "invalid_qr_kind"));
    }
    let Some(origin) = state.remote_access.urls.first() else {
        return Err(api_error(StatusCode::NOT_FOUND, "lan_access_disabled"));
    };
    let path = query
        .path
        .as_deref()
        .filter(|path| path.starts_with("/app/") && !path.contains(['?', '#']))
        .unwrap_or("/");
    let pairing = state
        .auth
        .lock()
        .map_err(|_| api_error(StatusCode::SERVICE_UNAVAILABLE, "auth_unavailable"))?
        .create_pairing(now_seconds());
    let mut url = format!("{origin}{path}?pairingToken={}", pairing.token);
    // 配对链接带外携带桌面 E2EE 静态公钥，手机扫码/打开链接时固定该公钥，
    // 之后每次中继会话都执行 Noise_XK 握手（服务器无法替换桌面身份）。
    if let Some(identity) = state.remote_access.e2ee_identity.as_ref() {
        url.push_str("&ek=");
        url.push_str(
            &identity
                .public_key_base64()
                .replace('+', "%2B")
                .replace('/', "%2F"),
        );
    }
    let data_url = qr_data_url(&url)?;
    Ok(Json(json!({
        "kind": "session",
        "url": url,
        "dataUrl": data_url,
        "expiresAt": pairing.expires_at,
        "caFingerprint": state.remote_access.ca_fingerprint,
    })))
}

fn lan_qr_issuer_allowed(peer_ip: IpAddr) -> bool {
    peer_ip.is_loopback()
}

fn qr_data_url(url: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let code = qrcode::QrCode::new(url.as_bytes())
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "qr_generation_failed"))?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(320, 320)
        .dark_color(qrcode::render::svg::Color("#111827"))
        .light_color(qrcode::render::svg::Color("#ffffff"))
        .build();
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg.as_bytes())
    ))
}

/// Local model gateway proxy. Pi (running on this machine) sends OpenAI-style
/// requests that may use the `developer` role, which the QVeris gateway
/// rejects (it only accepts system/user/assistant/tool/latest_reminder). The
/// proxy normalizes `developer` to `system` and forwards to QVeris, so chat
/// works for both the desktop and mobile clients that share this runtime.
async fn model_gateway_proxy(
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    method: Method,
    Path(path): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !peer.ip().is_loopback() {
        return api_error(StatusCode::FORBIDDEN, "loopback_only").into_response();
    }
    let auth_preview = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            if value.len() > 16 {
                format!("{}… ({} chars)", &value[..16], value.len())
            } else {
                value.to_string()
            }
        })
        .unwrap_or_else(|| "<none>".to_string());
    log::info!(
        "[model-gateway] {method} /{path} auth={auth_preview} body={} bytes",
        body.len()
    );
    let target = format!("{QVERIS_GATEWAY_TARGET}/{path}");
    let payload = if method == Method::POST {
        rewrite_developer_roles(&body).unwrap_or(body)
    } else {
        body
    };
    let mut request = reqwest::Client::new()
        .request(method, &target)
        .body(payload);
    for name in ["authorization", "content-type"] {
        if let Some(value) = headers.get(name) {
            request = request.header(name, value);
        }
    }
    let upstream = match request.send().await {
        Ok(response) => response,
        Err(_) => {
            return api_error(StatusCode::BAD_GATEWAY, "model_gateway_unreachable").into_response();
        }
    };
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let upstream_bytes = match upstream.bytes().await {
        Ok(bytes) => bytes,
        Err(_) => {
            return api_error(StatusCode::BAD_GATEWAY, "model_gateway_unreachable").into_response();
        }
    };
    let preview = String::from_utf8_lossy(&upstream_bytes[..upstream_bytes.len().min(200)]);
    log::info!(
        "[model-gateway] upstream {status} body={preview} ({} bytes)",
        upstream_bytes.len()
    );
    let mut builder = Response::builder().status(status);
    if let Some(value) = content_type {
        builder = builder.header("content-type", value);
    }
    builder
        .body(Body::from(upstream_bytes))
        .unwrap_or_else(|_| {
            api_error(StatusCode::INTERNAL_SERVER_ERROR, "model_gateway_stream").into_response()
        })
}

fn rewrite_developer_roles(body: &Bytes) -> Result<Bytes, serde_json::Error> {
    let mut value: Value = serde_json::from_slice(body)?;
    if let Some(messages) = value.get_mut("messages").and_then(Value::as_array_mut) {
        for message in messages {
            if message.get("role").and_then(Value::as_str) == Some("developer") {
                message["role"] = Value::String("system".to_owned());
            }
        }
    }
    Ok(Bytes::from(serde_json::to_vec(&value)?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapQuery {
    workspace_id: String,
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionsQuery {
    workspace_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginsQuery {
    scene_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginEnablementRequest {
    scene_id: String,
    plugin_id: String,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginPermissionRequest {
    scene_id: String,
    plugin_id: String,
    permission: String,
    granted: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginUninstallRequest {
    plugin_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginViewQuery {
    scene_id: String,
    plugin_id: String,
    view_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityInvokeRequest {
    scene_id: String,
    plugin_id: String,
    capability_id: String,
    #[serde(default)]
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommandInvokeRequest {
    scene_id: String,
    command_id: String,
    #[serde(default)]
    args: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginToolInvokeRequest {
    runtime_id: String,
    session_id: String,
    tool_call_id: String,
    tool_name: String,
    #[serde(default)]
    input: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotesQuery {
    scene_id: String,
    #[serde(default)]
    notebook_id: Option<String>,
    #[serde(default)]
    query: Option<String>,
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    source_only: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteQuery {
    scene_id: String,
    notebook_id: String,
    note_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotesChangesQuery {
    scene_id: String,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default = "default_note_changes_limit")]
    limit: usize,
}

fn default_note_changes_limit() -> usize {
    100
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateNotebookRequest {
    scene_id: String,
    title: String,
    #[serde(default)]
    icon: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateNotebookRequest {
    scene_id: String,
    notebook_id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    icon: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateNoteRequest {
    scene_id: String,
    notebook_id: String,
    title: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    icon: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveNoteRequest {
    scene_id: String,
    notebook_id: String,
    note_id: String,
    title: String,
    content: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    icon: Option<String>,
    expected_version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteNoteRequest {
    scene_id: String,
    notebook_id: String,
    note_id: String,
    expected_version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureNoteRequest {
    scene_id: String,
    notebook_id: String,
    url: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentRequest {
    scene_id: String,
    notebook_id: String,
    note_id: String,
    file_name: String,
    #[serde(default)]
    mime_type: String,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentQuery {
    scene_id: String,
    notebook_id: String,
    note_id: String,
    attachment_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportMarkdownRequest {
    scene_id: String,
    notebook_id: String,
    file_name: String,
    markdown: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportNotesQuery {
    scene_id: String,
    notebook_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportBackupRequest {
    scene_id: String,
    backup: VaultExport,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RebuildNotesRequest {
    scene_id: String,
    notebook_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactsQuery {
    scene_id: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    plugin_id: Option<String>,
    #[serde(default)]
    query: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactQuery {
    scene_id: String,
    artifact_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateArtifactRequest {
    scene_id: String,
    plugin_id: String,
    kind: String,
    title: String,
    #[serde(default)]
    summary: String,
    mime_type: String,
    #[serde(default)]
    provenance: Value,
    #[serde(default)]
    content: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteArtifactRequest {
    scene_id: String,
    artifact_id: String,
    expected_version: String,
}

async fn list_plugins(
    State(state): State<Arc<HostState>>,
    Query(query): Query<PluginsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "sceneId": query.scene_id,
        "plugins": registry.list(&query.scene_id),
        "diagnostics": registry.diagnostics(),
    })))
}

async fn read_plugin_view_source(
    State(state): State<Arc<HostState>>,
    Query(query): Query<PluginViewQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    let document = registry
        .view_document(&query.scene_id, &query.plugin_id, &query.view_id)
        .map_err(|message| {
            let (status, code) = if message.contains("not enabled") {
                (StatusCode::FORBIDDEN, "plugin_not_enabled")
            } else if message.contains("Unknown") || message.contains("does not declare") {
                (StatusCode::NOT_FOUND, "view_not_found")
            } else if message.contains("Built-in") {
                (StatusCode::BAD_REQUEST, "view_not_external")
            } else {
                (StatusCode::UNPROCESSABLE_ENTITY, "view_invalid")
            };
            plugin_api_error(status, code, &message)
        })?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "sceneId": query.scene_id,
        "view": document,
    })))
}

async fn list_notes(
    State(state): State<Arc<HostState>>,
    Query(query): Query<NotesQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &query.scene_id, false)?;
    let snapshot = state
        .notes
        .lock()
        .map_err(|_| {
            notes_api_error(NotesError {
                code: "storage_unavailable",
                message: "Notes vault is unavailable".into(),
            })
        })?
        .list(
            query.notebook_id.as_deref(),
            query.query.as_deref(),
            query.tag.as_deref(),
            query.source_only,
        )
        .map_err(notes_api_error)?;
    Ok(Json(
        json!({ "schemaVersion": 1, "sceneId": query.scene_id, "snapshot": snapshot }),
    ))
}

async fn list_note_knowledge(
    State(state): State<Arc<HostState>>,
    Query(query): Query<NotesQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &query.scene_id, false)?;
    let snapshot = state
        .notes
        .lock()
        .map_err(|_| {
            notes_api_error(NotesError {
                code: "storage_unavailable",
                message: "Notes vault is unavailable".into(),
            })
        })?
        .knowledge()
        .map_err(notes_api_error)?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "sceneId": query.scene_id,
        "snapshot": snapshot,
    })))
}

async fn list_note_changes(
    State(state): State<Arc<HostState>>,
    Query(query): Query<NotesChangesQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &query.scene_id, false)?;
    let snapshot = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .changes(query.cursor.as_deref(), query.limit)
        .map_err(notes_api_error)?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "sceneId": query.scene_id,
        "snapshot": snapshot,
    })))
}

async fn create_notebook(
    State(state): State<Arc<HostState>>,
    Json(request): Json<CreateNotebookRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let notebook = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .create_notebook(&request.title, request.icon)
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "notebook": notebook })))
}

async fn update_notebook(
    State(state): State<Arc<HostState>>,
    Json(request): Json<UpdateNotebookRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let notebook = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .update_notebook(&request.notebook_id, request.title, request.icon)
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "notebook": notebook })))
}

async fn get_note(
    State(state): State<Arc<HostState>>,
    Query(query): Query<NoteQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &query.scene_id, false)?;
    let note = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .get_note(&query.notebook_id, &query.note_id)
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "note": note })))
}

async fn create_note(
    State(state): State<Arc<HostState>>,
    Json(request): Json<CreateNoteRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let note = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .create_note(
            &request.notebook_id,
            &request.title,
            &request.content,
            request.tags,
            request.icon,
            None,
        )
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "note": note })))
}

async fn save_note(
    State(state): State<Arc<HostState>>,
    Json(request): Json<SaveNoteRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let note = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .save_note(
            &request.notebook_id,
            &request.note_id,
            &request.title,
            &request.content,
            request.tags,
            request.icon,
            &request.expected_version,
        )
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "note": note })))
}

async fn delete_note(
    State(state): State<Arc<HostState>>,
    Json(request): Json<DeleteNoteRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .delete_note(
            &request.notebook_id,
            &request.note_id,
            &request.expected_version,
        )
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "deleted": true, "noteId": request.note_id })))
}

async fn capture_note(
    State(state): State<Arc<HostState>>,
    Json(request): Json<CaptureNoteRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    ensure_notes_network_permission(&state, &request.scene_id)?;
    let captured = fetch_capture_source(&request.url)
        .await
        .map_err(notes_api_error)?;
    let hash = content_hash(&captured.markdown);
    let notes = state.notes.lock().map_err(|_| notes_unavailable())?;
    if let Some(existing) = notes
        .find_source_duplicate(&hash)
        .map_err(notes_api_error)?
    {
        return Ok(Json(json!({
            "duplicate": true,
            "note": existing,
        })));
    }
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&captured.title);
    let mut tags = request.tags;
    if !tags.iter().any(|tag| tag == "web-clip") {
        tags.push("web-clip".into());
    }
    let note = notes
        .create_note(
            &request.notebook_id,
            title,
            &captured.markdown,
            tags,
            Some("🌐".to_string()),
            Some(NoteSource {
                url: captured.final_url,
                captured_at: now_iso(),
                content_hash: hash,
                author: captured.author,
                published_at: captured.published_at,
            }),
        )
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "duplicate": false, "note": note })))
}

async fn upload_note_attachment(
    State(state): State<Arc<HostState>>,
    Json(request): Json<AttachmentRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(request.data_base64)
        .map_err(|_| {
            notes_api_error(NotesError::new(
                "invalid_parameters",
                "Attachment data is not valid base64",
            ))
        })?;
    let attachment = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .store_attachment(
            &request.notebook_id,
            &request.note_id,
            &request.file_name,
            &request.mime_type,
            &bytes,
        )
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "attachment": attachment })))
}

async fn read_note_attachment(
    State(state): State<Arc<HostState>>,
    Query(query): Query<AttachmentQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &query.scene_id, false)?;
    let (bytes, mime_type) = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .read_attachment(&query.notebook_id, &query.note_id, &query.attachment_id)
        .map_err(notes_api_error)?;
    Response::builder()
        .status(StatusCode::OK)
        .header(axum::http::header::CONTENT_TYPE, mime_type)
        .header(axum::http::header::CACHE_CONTROL, "private, max-age=300")
        .header("x-content-type-options", "nosniff")
        .header("content-security-policy", "default-src 'none'; sandbox")
        .body(Body::from(bytes))
        .map_err(|_| notes_unavailable())
}

async fn import_markdown_note(
    State(state): State<Arc<HostState>>,
    Json(request): Json<ImportMarkdownRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let note = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .import_markdown(&request.notebook_id, &request.file_name, &request.markdown)
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "note": note })))
}

async fn export_notes_backup(
    State(state): State<Arc<HostState>>,
    Query(query): Query<ExportNotesQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &query.scene_id, false)?;
    let backup = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .export_notebook(&query.notebook_id)
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "backup": backup })))
}

async fn import_notes_backup(
    State(state): State<Arc<HostState>>,
    Json(request): Json<ImportBackupRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let notebook = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .import_export(request.backup)
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "notebook": notebook })))
}

async fn rebuild_notes_index(
    State(state): State<Arc<HostState>>,
    Json(request): Json<RebuildNotesRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_notes_authorized(&state, &request.scene_id, true)?;
    let report = state
        .notes
        .lock()
        .map_err(|_| notes_unavailable())?
        .rebuild_index(&request.notebook_id)
        .map_err(notes_api_error)?;
    Ok(Json(json!({ "report": report })))
}

async fn list_artifacts(
    State(state): State<Arc<HostState>>,
    Query(query): Query<ArtifactsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &query.scene_id, None)?;
    let snapshot = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?
        .list(
            &query.scene_id,
            query.kind.as_deref(),
            query.plugin_id.as_deref(),
            query.query.as_deref(),
        )
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "sceneId": query.scene_id,
        "snapshot": snapshot,
    })))
}

async fn get_artifact(
    State(state): State<Arc<HostState>>,
    Query(query): Query<ArtifactQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &query.scene_id, None)?;
    let artifact = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?
        .get(&query.scene_id, &query.artifact_id)
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({ "artifact": artifact })))
}

async fn create_artifact(
    State(state): State<Arc<HostState>>,
    Json(request): Json<CreateArtifactRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &request.scene_id, Some(&request.plugin_id))?;
    let artifact = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?
        .create(ArtifactDraft {
            scene_id: request.scene_id,
            plugin_id: request.plugin_id,
            kind: request.kind,
            title: request.title,
            summary: request.summary,
            mime_type: request.mime_type,
            provenance: request.provenance,
            content: request.content,
        })
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({ "artifact": artifact })))
}

async fn delete_artifact(
    State(state): State<Arc<HostState>>,
    Json(request): Json<DeleteArtifactRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_artifacts_authorized(&state, &request.scene_id, None)?;
    state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?
        .delete(
            &request.scene_id,
            &request.artifact_id,
            &request.expected_version,
        )
        .map_err(artifacts_api_error)?;
    Ok(Json(json!({
        "deleted": true,
        "artifactId": request.artifact_id,
    })))
}

async fn list_plugin_capabilities(
    State(state): State<Arc<HostState>>,
    Query(query): Query<PluginsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "sceneId": query.scene_id,
        "capabilities": registry.capabilities(&query.scene_id),
    })))
}

async fn invoke_plugin_capability(
    State(state): State<Arc<HostState>>,
    Json(request): Json<CapabilityInvokeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    let mut broker = state.capability_broker.lock().map_err(|_| {
        plugin_api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "capability_broker_unavailable",
            "",
        )
    })?;
    let result = broker
        .invoke(
            &registry,
            CapabilityInvocation {
                caller: "chat".into(),
                scene_id: request.scene_id,
                plugin_id: request.plugin_id,
                capability_id: request.capability_id,
                tool_call_id: None,
                idempotency_scope: None,
                input: request.input,
            },
        )
        .map_err(capability_api_error)?;
    Ok(Json(json!({ "result": result })))
}

async fn invoke_plugin_command(
    State(state): State<Arc<HostState>>,
    Json(request): Json<CommandInvokeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if request.scene_id.is_empty()
        || request.command_id.is_empty()
        || request.command_id.len() > 256
    {
        return Err(plugin_api_error(
            StatusCode::BAD_REQUEST,
            "invalid_parameters",
            "sceneId and commandId are required",
        ));
    }
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    let mut broker = state.capability_broker.lock().map_err(|_| {
        plugin_api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "capability_broker_unavailable",
            "",
        )
    })?;
    let result = broker
        .invoke_command(
            &registry,
            &request.scene_id,
            &request.command_id,
            request.args,
        )
        .map_err(capability_api_error)?;
    Ok(Json(json!({ "result": result })))
}

async fn invoke_plugin_tool(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<PluginToolInvokeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if request.tool_call_id.is_empty()
        || request.tool_call_id.len() > 256
        || request.runtime_id.is_empty()
        || request.session_id.is_empty()
    {
        return Err(plugin_api_error(
            StatusCode::BAD_REQUEST,
            "invalid_parameters",
            "runtimeId, sessionId, and toolCallId are required",
        ));
    }
    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            plugin_api_error(
                StatusCode::UNAUTHORIZED,
                "broker_auth_required",
                "A runtime broker token is required",
            )
        })?;
    let record = {
        let mut tokens = state.plugin_tokens.lock().map_err(|_| {
            plugin_api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "broker_auth_unavailable",
                "",
            )
        })?;
        let now = SystemTime::now();
        tokens.retain(|_, record| record.expires_at > now);
        tokens.get(&request.runtime_id).cloned()
    }
    .ok_or_else(|| {
        plugin_api_error(
            StatusCode::UNAUTHORIZED,
            "broker_token_invalid",
            "Runtime broker token is invalid or expired",
        )
    })?;
    if record.token_hash != sha256_hex(bearer.as_bytes())
        || record.target.session_id != request.session_id
        || record.target.instance_id != request.runtime_id
    {
        return Err(plugin_api_error(
            StatusCode::UNAUTHORIZED,
            "broker_token_invalid",
            "Runtime broker token does not match this runtime",
        ));
    }
    let live = state
        .runtimes
        .statuses()
        .map(|statuses| statuses.iter().any(|status| status.target == record.target))
        .unwrap_or(false);
    if !live {
        return Err(plugin_api_error(
            StatusCode::GONE,
            "runtime_stopped",
            "The runtime that owns this broker token is no longer active",
        ));
    }
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    let tool = registry
        .pi_tools(&record.target.scene_id)
        .into_iter()
        .find(|tool| tool.name == request.tool_name)
        .ok_or_else(|| {
            plugin_api_error(
                StatusCode::NOT_FOUND,
                "tool_unavailable",
                "The tool is missing, disabled, or not granted for this scene",
            )
        })?;
    let mut broker = state.capability_broker.lock().map_err(|_| {
        plugin_api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "capability_broker_unavailable",
            "",
        )
    })?;
    let result = broker
        .invoke(
            &registry,
            CapabilityInvocation {
                caller: "pi".into(),
                scene_id: record.target.scene_id.clone(),
                plugin_id: tool.plugin_id,
                capability_id: tool.capability,
                tool_call_id: Some(request.tool_call_id),
                idempotency_scope: Some(record.target.instance_id),
                input: request.input,
            },
        )
        .map_err(capability_api_error)?;
    Ok(Json(json!({ "result": result })))
}

async fn set_plugin_enablement(
    State(state): State<Arc<HostState>>,
    Json(request): Json<PluginEnablementRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    registry
        .set_enabled(&request.scene_id, &request.plugin_id, request.enabled)
        .map_err(|message| {
            plugin_api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "enablement_rejected",
                &message,
            )
        })?;
    Ok(Json(json!({
        "pluginId": request.plugin_id,
        "sceneId": request.scene_id,
        "enabled": request.enabled,
    })))
}

async fn set_plugin_permission(
    State(state): State<Arc<HostState>>,
    Json(request): Json<PluginPermissionRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    registry
        .set_permission(
            &request.scene_id,
            &request.plugin_id,
            &request.permission,
            request.granted,
        )
        .map_err(|message| {
            plugin_api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "permission_rejected",
                &message,
            )
        })?;
    Ok(Json(json!({
        "pluginId": request.plugin_id,
        "sceneId": request.scene_id,
        "permission": request.permission,
        "granted": request.granted,
    })))
}

async fn reload_plugins(
    State(state): State<Arc<HostState>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    registry.reload_developer_plugins().map_err(|message| {
        plugin_api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "plugin_reload_failed",
            &message,
        )
    })?;
    Ok(Json(json!({
        "reloaded": true,
        "diagnostics": registry.diagnostics(),
    })))
}

async fn uninstall_plugin(
    State(state): State<Arc<HostState>>,
    Json(request): Json<PluginUninstallRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    registry
        .uninstall_developer(&request.plugin_id)
        .map_err(|message| {
            plugin_api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "uninstall_rejected",
                &message,
            )
        })?;
    Ok(Json(json!({
        "pluginId": request.plugin_id,
        "uninstalled": true,
        "dataPreserved": true,
    })))
}

async fn list_all_sessions_http(
    State(state): State<Arc<HostState>>,
    Query(query): Query<SessionsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let sessions = state
        .data
        .list_all_sessions(&query.workspace_id)
        .map_err(host_data_http_error)?;
    let mut sessions = serde_json::to_value(sessions)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "serialization_failed"))?;
    if let Ok(statuses) = state.runtimes.statuses() {
        annotate_live_sessions(&mut sessions, statuses);
    }
    Ok(Json(json!({ "sessions": sessions })))
}

async fn bootstrap_target(
    State(state): State<Arc<HostState>>,
    Query(query): Query<BootstrapQuery>,
) -> Result<Json<RuntimeTarget>, (StatusCode, Json<Value>)> {
    // A live runtime already exists for this session — reuse it.
    if let Some(target) = state
        .runtimes
        .target_for_session(&query.workspace_id, &query.session_id)
    {
        return Ok(Json(target));
    }

    // Otherwise this is a historical session opened from the sidebar. Lazily
    // spawn a runtime that resumes the saved session file so its messages load
    // instead of failing with "runtime stopped/unavailable".
    let session_path = state
        .data
        .resolve_session_path(&query.workspace_id, &query.session_id)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "session_lookup_failed"))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "session_not_found"))?;
    let cwd = state
        .data
        .workspace_root_path(&query.workspace_id)
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "workspace_not_found"))?;
    let scene_id = state
        .data
        .scene_id_for_session(&query.workspace_id, &query.session_id)
        .ok()
        .flatten()
        .unwrap_or_else(|| "programming".to_string());
    let target = RuntimeTarget::new(
        query.workspace_id.clone(),
        query.session_id.clone(),
        format!("instance-{}", uuid::Uuid::new_v4().simple()),
    )
    .with_scene(scene_id);
    let mut launch = state
        .pi_launch
        .native_launch_spec(
            &cwd.to_string_lossy(),
            Some(&session_path.to_string_lossy()),
            &target,
        )
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "launch_spec_failed"))?;
    configure_plugin_broker_for_state(&state, &target, &mut launch)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "plugin_broker_failed"))?;
    state
        .runtimes
        .spawn(target.clone(), launch)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "runtime_spawn_failed"))?;
    Ok(Json(target))
}

/// M2: remote client configuration served to the authenticated phone (or the
/// desktop UI). Today this carries the WebRTC `iceServers` (STUN/TURN) so P2P
/// can cross NAT once the coturn deployment is configured; the array is empty
/// when no servers are set.
async fn remote_config() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let config = crate::remote_access_config::load()
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "remote_config_failed"))?;
    Ok(Json(json!({
        "iceServers": crate::remote_access_config::build_remote_ice_servers(&config),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewSessionRequest {
    workspace_id: String,
    #[serde(default)]
    scene_id: Option<String>,
}

/// POST /v2/new-session — spawn a fresh temporary runtime for `workspaceId`.
/// Used by LAN/remote clients that cannot invoke Tauri native commands.
async fn new_session(
    State(state): State<Arc<HostState>>,
    Json(body): Json<NewSessionRequest>,
) -> Result<Json<RuntimeTarget>, (StatusCode, Json<Value>)> {
    let cwd = state
        .data
        .workspace_root_path(&body.workspace_id)
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "workspace_not_found"))?;
    let session_id = format!("temporary-{}", uuid::Uuid::new_v4().simple());
    let instance_id = format!("instance-{}", uuid::Uuid::new_v4().simple());
    let target = RuntimeTarget::new(body.workspace_id.clone(), session_id, instance_id)
        .with_scene(body.scene_id.as_deref().unwrap_or("programming"));
    let cwd_str = cwd.to_string_lossy().into_owned();
    let mut launch = state
        .pi_launch
        .native_launch_spec(&cwd_str, None, &target)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "launch_spec_failed"))?;
    configure_plugin_broker_for_state(&state, &target, &mut launch)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "plugin_broker_failed"))?;
    state
        .runtimes
        .spawn(target.clone(), launch)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "runtime_spawn_failed"))?;
    Ok(Json(target))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveWorkspaceRequest {
    project_path: String,
}

/// POST /v2/resolve-workspace — map a project path to its stable workspace id
/// and register the workspace root so subsequent `/v2/bootstrap` calls can
/// lazily resume its sessions. Used by LAN/mobile clients switching to a
/// session that belongs to a different project (no Tauri window mechanism).
async fn resolve_workspace(
    State(state): State<Arc<HostState>>,
    Json(body): Json<ResolveWorkspaceRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let path = PathBuf::from(&body.project_path);
    if !path.is_dir() {
        return Err(api_error(StatusCode::NOT_FOUND, "project_not_found"));
    }
    let workspace_id = state
        .auth
        .lock()
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "auth_unavailable"))?
        .resolve_workspace(&path)
        .map_err(|_| {
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "workspace_resolve_failed",
            )
        })?;
    state
        .data
        .register_workspace(&workspace_id, path)
        .map_err(|_| {
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "workspace_register_failed",
            )
        })?;
    Ok(Json(json!({ "workspaceId": workspace_id })))
}

async fn websocket_upgrade(
    State(state): State<Arc<HostState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: axum::http::HeaderMap,
    websocket: WebSocketUpgrade,
) -> Response {
    if !websocket_origin_allowed(peer.ip(), &headers, &state.allowed_origins) {
        return StatusCode::FORBIDDEN.into_response();
    }
    websocket
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_websocket(socket, state, peer.ip(), false))
}

/// WebSocket upgrade for the public tunnel gateway. Tunneled connections
/// arrive from the loopback address, so the normal loopback exemption would
/// let unauthenticated clients in; here a remote device token is always
/// required.
async fn websocket_upgrade_public(
    State(state): State<Arc<HostState>>,
    headers: axum::http::HeaderMap,
    websocket: WebSocketUpgrade,
) -> Response {
    if !websocket_origin_allowed_strict(&headers, &state.allowed_origins) {
        return StatusCode::FORBIDDEN.into_response();
    }
    websocket
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| {
            handle_websocket(socket, state, IpAddr::V4(Ipv4Addr::LOCALHOST), true)
        })
}

fn websocket_origin_allowed(
    peer_ip: IpAddr,
    headers: &HeaderMap,
    allowed_origins: &HashSet<String>,
) -> bool {
    match headers
        .get(axum::http::header::ORIGIN)
        .and_then(|origin| origin.to_str().ok())
    {
        Some(origin) => allowed_origins.contains(origin),
        None => peer_ip.is_loopback(),
    }
}

fn websocket_origin_allowed_strict(headers: &HeaderMap, allowed_origins: &HashSet<String>) -> bool {
    headers
        .get(axum::http::header::ORIGIN)
        .and_then(|origin| origin.to_str().ok())
        .is_some_and(|origin| allowed_origins.contains(origin))
}

/// Send one runtime frame to the session: over the P2P DataChannel when a
/// P2P connection is live, otherwise over the WebSocket. Signaling frames
/// (`p2p_*`) always stay on the WebSocket.
async fn send_runtime_frame(
    socket: &mut WebSocket,
    p2p: &Option<Arc<crate::p2p::P2pAnswerer>>,
    value: &Value,
) -> bool {
    let text = value.to_string();
    if let Some(answerer) = p2p {
        if answerer.is_connected() {
            return answerer.send(text.into_bytes()).await.is_ok();
        }
    }
    socket.send(Message::Text(text.into())).await.is_ok()
}

/// Route one inbound runtime frame (from the WebSocket or a P2P DataChannel)
/// through the host router and send the response back over the active data
/// sink. Returns `Err(())` when the sink is gone.
async fn process_runtime_frame(
    state: &Arc<HostState>,
    client_id: &str,
    subscriptions: &mut HashSet<RuntimeTarget>,
    frame: Value,
    socket: &mut WebSocket,
    p2p: &Option<Arc<crate::p2p::P2pAnswerer>>,
) -> Result<(), ()> {
    let request_id = frame
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let routed = state
        .router
        .lock()
        .map_err(|_| ("router_unavailable", "Host router unavailable".to_string()))
        .and_then(|router| {
            router
                .route(client_id, &frame)
                .map_err(|error| (error.code, error.message))
        });
    let mut after_response = Vec::new();
    let response = match routed {
        Ok(RoutedAction::Subscribe {
            request_id, target, ..
        }) => match serde_json::from_value::<RuntimeTarget>(target) {
            Ok(target) => {
                subscriptions.insert(target.clone());
                let owns_session = state
                    .session_owners
                    .lock()
                    .map(|mut owners| {
                        owners
                            .entry(target.clone())
                            .or_insert_with(|| client_id.to_string())
                            == client_id
                    })
                    .unwrap_or(false);
                if owns_session {
                    if let Ok(pending) = state.runtimes.pending_extension_ui(&target) {
                        after_response.extend(pending.into_iter().map(runtime_event_frame));
                    }
                }
                Ok(json!({ "type": "runtime_subscribed", "requestId": request_id }))
            }
            Err(_) => Err(("invalid_target", "Runtime target is invalid".into())),
        },
        Ok(action) => dispatch(action, state).await,
        Err((code, message)) => Err((code, message)),
    };
    let outgoing = match response {
        Ok(value) => value,
        Err((code, message)) => structured_error(request_id.as_deref(), code, &message),
    };
    if !send_runtime_frame(socket, p2p, &outgoing).await {
        return Err(());
    }
    for replay in after_response {
        if !send_runtime_frame(socket, p2p, &replay).await {
            return Err(());
        }
    }
    Ok(())
}

async fn handle_websocket(
    mut socket: WebSocket,
    state: Arc<HostState>,
    peer_ip: IpAddr,
    require_remote_auth: bool,
) {
    let Some(Ok(Message::Text(first))) = socket.next().await else {
        return;
    };
    let hello = match serde_json::from_str::<Value>(&first) {
        Ok(frame) => frame,
        Err(_) => {
            let _ = send_error(&mut socket, None, "invalid_json", "Invalid JSON frame").await;
            return;
        }
    };
    let client_id = match hello.get("clientId").and_then(Value::as_str) {
        Some(value) if !value.is_empty() => value.to_owned(),
        _ => {
            let _ = send_error(
                &mut socket,
                None,
                "invalid_client_id",
                "clientId is required",
            )
            .await;
            return;
        }
    };
    let client_type = hello.get("clientType").and_then(Value::as_str);
    let remote_device_token = (client_type == Some("remote"))
        .then(|| {
            hello
                .get("deviceToken")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .flatten();
    if (!peer_ip.is_loopback() || require_remote_auth) && client_type != Some("remote") {
        let _ = send_error(
            &mut socket,
            None,
            "remote_auth_required",
            "Non-loopback clients must authenticate as remote devices",
        )
        .await;
        return;
    }
    if client_type == Some("remote") {
        let authorized = remote_device_token
            .as_deref()
            .and_then(|token| state.auth.lock().ok()?.authorize(token).ok())
            .unwrap_or(false);
        if !authorized {
            let _ = send_error(
                &mut socket,
                None,
                "unauthorized_device",
                "Device token rejected",
            )
            .await;
            return;
        }
    }
    let handshake = state
        .router
        .lock()
        .map_err(|_| "Host router unavailable".to_string())
        .and_then(|mut router| {
            router
                .connect(&client_id, &hello)
                .map_err(|error| error.message)
        });
    if let Err(message) = handshake {
        let _ = send_error(&mut socket, None, "handshake_rejected", &message).await;
        return;
    }
    if socket
        .send(Message::Text(
            json!({ "type": "hello_ack", "protocolVersion": PROTOCOL_VERSION })
                .to_string()
                .into(),
        ))
        .await
        .is_err()
    {
        return;
    }

    let mut runtime_events = state.runtimes.subscribe();
    let mut subscriptions = HashSet::new();
    let mut remote_auth_check = tokio::time::interval(Duration::from_secs(5));
    remote_auth_check.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // M2 P2P session state: the answerer peer, its outbound signaling frames,
    // and DataChannel messages (routed back into the runtime pipeline).
    let mut p2p_answerer: Option<Arc<crate::p2p::P2pAnswerer>> = None;
    let mut p2p_signals: Option<mpsc::UnboundedReceiver<Value>> = None;
    let mut p2p_inbound: Option<mpsc::UnboundedReceiver<Value>> = None;
    loop {
        tokio::select! {
            _ = remote_auth_check.tick(), if remote_device_token.is_some() => {
                let authorized = remote_device_token
                    .as_deref()
                    .and_then(|token| state.auth.lock().ok()?.authorize(token).ok())
                    .unwrap_or(false);
                if !authorized {
                    let _ = send_error(
                        &mut socket,
                        None,
                        "device_access_revoked",
                        "This device no longer has access",
                    )
                    .await;
                    break;
                }
            }
            incoming = socket.next() => {
                let Some(Ok(message)) = incoming else { break };
                let Message::Text(text) = message else {
                    if matches!(message, Message::Close(_)) { break; }
                    continue;
                };
                let frame = match serde_json::from_str::<Value>(&text) {
                    Ok(frame) => frame,
                    Err(_) => {
                        let _ = send_error(&mut socket, None, "invalid_json", "Invalid JSON frame").await;
                        continue;
                    }
                };
                if crate::p2p::is_p2p_signal(&frame) {
                    if frame.get("type").and_then(Value::as_str) == Some("p2p_offer") {
                        match crate::p2p::P2pAnswerer::new() {
                            Ok((answerer, handle)) => {
                                let answerer = Arc::new(answerer);
                                let (inbound_tx, inbound_rx) = mpsc::unbounded_channel();
                                let mut messages = handle.messages;
                                tokio::spawn(async move {
                                    while let Some(bytes) = messages.recv().await {
                                        if let Ok(frame) = serde_json::from_slice::<Value>(&bytes) {
                                            if inbound_tx.send(frame).is_err() {
                                                break;
                                            }
                                        }
                                    }
                                });
                                p2p_answerer = Some(answerer.clone());
                                p2p_signals = Some(handle.signals);
                                p2p_inbound = Some(inbound_rx);
                                if let Err(error) = answerer.handle_signal(frame).await {
                                    let _ = send_error(&mut socket, None, "p2p_signal_failed", &error)
                                        .await;
                                }
                            }
                            Err(error) => {
                                let _ =
                                    send_error(&mut socket, None, "p2p_unavailable", &error).await;
                            }
                        }
                    } else if let Some(answerer) = &p2p_answerer {
                        if let Err(error) = answerer.handle_signal(frame).await {
                            let _ =
                                send_error(&mut socket, None, "p2p_signal_failed", &error).await;
                        }
                    }
                    continue;
                }
                if process_runtime_frame(
                    &state,
                    &client_id,
                    &mut subscriptions,
                    frame,
                    &mut socket,
                    &p2p_answerer,
                )
                .await
                .is_err()
                {
                    break;
                }
            }
            signal = async {
                match p2p_signals.as_mut() {
                    Some(receiver) => receiver.recv().await,
                    None => futures_util::future::pending().await,
                }
            } => {
                if let Some(signal) = signal {
                    if socket.send(Message::Text(signal.to_string().into())).await.is_err() {
                        break;
                    }
                }
            }
            message = async {
                match p2p_inbound.as_mut() {
                    Some(receiver) => receiver.recv().await,
                    None => futures_util::future::pending().await,
                }
            } => {
                if let Some(frame) = message {
                    if process_runtime_frame(
                        &state,
                        &client_id,
                        &mut subscriptions,
                        frame,
                        &mut socket,
                        &p2p_answerer,
                    )
                    .await
                    .is_err()
                    {
                        break;
                    }
                }
            }
            event = runtime_events.recv() => {
                match event {
                    Ok(event) if subscriptions.contains(&event.target) => {
                        if extension_ui_requires_owner(&event.event) {
                            let is_owner = state
                                .session_owners
                                .lock()
                                .ok()
                                .and_then(|owners| owners.get(&event.target).cloned())
                                .as_deref()
                                == Some(client_id.as_str());
                            if !is_owner { continue; }
                        }
                        let outgoing = runtime_event_frame(event);
                        if !send_runtime_frame(&mut socket, &p2p_answerer, &outgoing).await {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let outgoing = structured_error(
                            None,
                            "event_sequence_gap",
                            "Runtime events were missed; request a snapshot",
                        );
                        if !send_runtime_frame(&mut socket, &p2p_answerer, &outgoing).await {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    if let Ok(mut owners) = state.session_owners.lock() {
        owners.retain(|_, owner| owner != &client_id);
    }
}

fn extension_ui_requires_owner(event: &Value) -> bool {
    if event.get("type").and_then(Value::as_str) != Some("extension_ui_request") {
        return false;
    }
    matches!(
        event.get("method").and_then(Value::as_str),
        Some("select" | "confirm" | "input" | "editor")
    )
}

fn runtime_event_frame(event: crate::native_pi_manager::NativeRuntimeEvent) -> Value {
    json!({
        "type": "runtime_event",
        "target": event.target,
        "sequence": event.sequence,
        "event": event.event,
    })
}

fn annotate_live_sessions(sessions: &mut Value, statuses: Vec<RuntimeStatus>) {
    let Some(items) = sessions.as_array_mut() else {
        return;
    };
    for session in items {
        let Some(session_id) = session.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(status) = statuses
            .iter()
            .find(|status| status.target.session_id == session_id)
        else {
            continue;
        };
        session["target"] = json!(status.target);
        session["status"] = json!(status.state);
    }
}

fn messages_from_entries_response(response: &Value) -> Value {
    let Some(entries) = response.pointer("/data/entries").and_then(Value::as_array) else {
        return json!([]);
    };
    let leaf_id = response.pointer("/data/leafId").and_then(Value::as_str);
    let mut id_to_index = HashMap::new();
    for (index, entry) in entries.iter().enumerate() {
        if let Some(id) = entry.get("id").and_then(Value::as_str) {
            id_to_index.insert(id, index);
        }
    }

    let mut branch = Vec::new();
    let mut current = leaf_id.and_then(|id| id_to_index.get(id).copied());
    let mut visited = HashSet::new();
    while let Some(index) = current {
        if !visited.insert(index) {
            break;
        }
        let entry = &entries[index];
        if entry.get("type").and_then(Value::as_str) == Some("message") {
            if let Some(message) = entry.get("message") {
                branch.push(message_with_entry_id(
                    message.clone(),
                    entry.get("id").and_then(Value::as_str),
                ));
            }
        }
        current = entry
            .get("parentId")
            .and_then(Value::as_str)
            .and_then(|parent_id| id_to_index.get(parent_id).copied());
    }

    branch.reverse();
    Value::Array(branch)
}

fn message_with_entry_id(mut message: Value, entry_id: Option<&str>) -> Value {
    if message.get("role").and_then(Value::as_str) != Some("user") {
        return message;
    }
    let Some(entry_id) = entry_id else {
        return message;
    };
    if let Some(object) = message.as_object_mut() {
        object.insert("entryId".to_owned(), Value::String(entry_id.to_owned()));
    }
    message
}

async fn dispatch(
    action: RoutedAction,
    state: &HostState,
) -> Result<Value, (&'static str, String)> {
    match action {
        RoutedAction::Runtime {
            client_id,
            request_id,
            frame,
        } => {
            if frame.get("type").and_then(Value::as_str) == Some("runtime_snapshot_request") {
                let session_id = frame
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_session", "sessionId is required".into()))?;
                let mut target = state
                    .runtimes
                    .target_for_session_id(session_id)
                    .ok_or(("runtime_not_found", "Runtime session is not running".into()))?;
                let state_response = state
                    .runtimes
                    .request(
                        &target,
                        json!({ "type": "get_state" }),
                        None,
                        Duration::from_secs(10),
                    )
                    .await
                    .map_err(|message| ("snapshot_failed", message))?;
                if target.session_id.starts_with("temporary-") {
                    if let Some(formal_session_id) = state_response
                        .pointer("/data/sessionId")
                        .and_then(Value::as_str)
                        .filter(|session_id| !session_id.is_empty())
                    {
                        target = state
                            .runtimes
                            .bind_session_id(&target, formal_session_id)
                            .map_err(|message| ("session_binding_failed", message))?;
                    }
                }
                let entries_response = state
                    .runtimes
                    .request(
                        &target,
                        json!({ "type": "get_entries" }),
                        None,
                        Duration::from_secs(10),
                    )
                    .await
                    .map_err(|message| ("snapshot_failed", message))?;
                let messages = messages_from_entries_response(&entries_response);
                let host_snapshot = state
                    .runtimes
                    .snapshot(&target)
                    .map_err(|message| ("snapshot_failed", message))?;
                return Ok(json!({
                    "type": "runtime_snapshot",
                    "requestId": request_id,
                    "target": target,
                    "sequence": host_snapshot.sequence,
                    "state": {
                        "lifecycle": host_snapshot.state,
                        "pi": state_response.get("data").cloned().unwrap_or(Value::Null),
                        "messages": messages,
                    }
                }));
            }
            if frame.get("type").and_then(Value::as_str) == Some("runtime_capabilities_request") {
                return Ok(json!({
                    "type": "runtime_capabilities",
                    "requestId": request_id,
                    "protocolVersion": PROTOCOL_VERSION,
                    "nativeRpc": true,
                    "extensionUi": true,
                    "sessionTree": true,
                    "oauth": false,
                    "hostDataPlane": true,
                    "sourcePreservingFork": false,
                }));
            }
            if frame.get("type").and_then(Value::as_str) != Some("runtime_request") {
                return Err((
                    "unsupported_runtime_request",
                    "Unsupported runtime request".into(),
                ));
            }
            let target: RuntimeTarget = serde_json::from_value(
                frame
                    .get("target")
                    .cloned()
                    .ok_or(("invalid_target", "Runtime target is required".into()))?,
            )
            .map_err(|_| ("invalid_target", "Runtime target is invalid".into()))?;
            let command = frame
                .get("command")
                .cloned()
                .ok_or(("invalid_command", "Runtime command is required".into()))?;
            if command.get("type").and_then(Value::as_str) == Some("extension_ui_response") {
                let is_owner = state
                    .session_owners
                    .lock()
                    .map_err(|_| {
                        (
                            "dialog_owner_unavailable",
                            "Dialog owner unavailable".into(),
                        )
                    })?
                    .get(&target)
                    .is_some_and(|owner| owner == &client_id);
                if !is_owner {
                    return Err((
                        "dialog_response_forbidden",
                        "Only the owning client may answer this dialog".into(),
                    ));
                }
                state
                    .runtimes
                    .respond_extension_ui(&target, command)
                    .await
                    .map_err(|message| ("dialog_response_failed", message))?;
                return Ok(json!({
                    "type": "runtime_response",
                    "requestId": request_id,
                    "acceptance": "completed",
                    "response": { "success": true },
                }));
            }
            let idempotency_key = frame.get("idempotencyKey").and_then(Value::as_str);
            if let Ok(mut owners) = state.session_owners.lock() {
                owners.insert(target.clone(), client_id);
            }
            let response = state
                .runtimes
                .request(&target, command, idempotency_key, Duration::from_secs(30))
                .await
                .map_err(|message| ("runtime_request_failed", message))?;
            Ok(json!({
                "type": "runtime_response",
                "requestId": request_id,
                "acceptance": "accepted",
                "response": response,
            }))
        }
        RoutedAction::Auth {
            request_id, frame, ..
        } => match frame.get("operation").and_then(Value::as_str) {
            Some("create_pairing") => {
                let pairing = state
                    .auth
                    .lock()
                    .map_err(|_| ("auth_unavailable", "Remote auth unavailable".into()))?
                    .create_pairing(now_seconds());
                Ok(json!({
                    "type": "auth_response",
                    "requestId": request_id,
                    "pairingToken": pairing.token,
                    "expiresAt": pairing.expires_at,
                }))
            }
            Some("list_devices") => {
                let devices = state
                    .auth
                    .lock()
                    .map_err(|_| ("auth_unavailable", "Remote auth unavailable".into()))?
                    .list_devices()
                    .map_err(|message| ("device_list_failed", message))?;
                Ok(json!({
                    "type": "auth_response",
                    "requestId": request_id,
                    "devices": devices.into_iter().map(|device| json!({
                        "deviceId": device.device_id,
                        "deviceName": device.device_name,
                        "pairedAt": device.paired_at,
                        "lastSeenAt": device.last_seen_at,
                        "revokedAt": device.revoked_at,
                    })).collect::<Vec<_>>(),
                }))
            }
            Some("remote_access_status") => {
                let config = crate::remote_access_config::load()
                    .map_err(|message| ("remote_access_config_failed", message))?;
                Ok(remote_access_status_payload(
                    state,
                    &config,
                    config.enabled != state.remote_access.running,
                    &request_id,
                ))
            }
            Some("set_remote_access_enabled") => {
                let enabled = frame.get("enabled").and_then(Value::as_bool).ok_or((
                    "invalid_remote_access_setting",
                    "enabled must be a boolean".into(),
                ))?;
                let config = crate::remote_access_config::set_enabled(enabled)
                    .map_err(|message| ("remote_access_config_failed", message))?;
                Ok(remote_access_status_payload(
                    state,
                    &config,
                    enabled != state.remote_access.running,
                    &request_id,
                ))
            }
            Some("set_remote_access_public") => {
                let public_url = frame
                    .get("publicUrl")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let public_enrollment_url = frame
                    .get("publicEnrollmentUrl")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let config =
                    crate::remote_access_config::update_public(public_url, public_enrollment_url)
                        .map_err(|message| ("invalid_public_access_setting", message))?;
                Ok(remote_access_status_payload(
                    state,
                    &config,
                    true,
                    &request_id,
                ))
            }
            Some("set_remote_access_relay") => {
                let relay_enabled = frame
                    .get("relayEnabled")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let relay_url = frame
                    .get("relayUrl")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let relay_device_id = frame
                    .get("relayDeviceId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let config = crate::remote_access_config::update_relay(
                    relay_enabled,
                    relay_url,
                    relay_device_id,
                )
                .map_err(|message| ("invalid_relay_setting", message))?;
                Ok(remote_access_status_payload(
                    state,
                    &config,
                    true,
                    &request_id,
                ))
            }
            Some("set_remote_access_turn") => {
                let relay_turn_url = frame
                    .get("relayTurnUrl")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let relay_turn_realm = frame
                    .get("relayTurnRealm")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let relay_turn_secret = frame
                    .get("relayTurnSecret")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let config = crate::remote_access_config::update_relay_turn(
                    relay_turn_url,
                    relay_turn_realm,
                    relay_turn_secret,
                )
                .map_err(|message| ("invalid_relay_setting", message))?;
                Ok(remote_access_status_payload(
                    state,
                    &config,
                    true,
                    &request_id,
                ))
            }
            Some("revoke_device") => {
                let device_id = frame
                    .get("deviceId")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .ok_or(("invalid_device", "deviceId is required".into()))?;
                state
                    .auth
                    .lock()
                    .map_err(|_| ("auth_unavailable", "Remote auth unavailable".into()))?
                    .revoke(device_id)
                    .map_err(|message| ("device_revoke_failed", message))?;
                Ok(json!({
                    "type": "auth_response",
                    "requestId": request_id,
                    "deviceId": device_id,
                    "revoked": true,
                }))
            }
            _ => Err((
                "unknown_auth_operation",
                "Unsupported auth operation".into(),
            )),
        },
        RoutedAction::Host {
            request_id,
            operation,
            frame,
            ..
        } => dispatch_host_operation(state, &request_id, &operation, &frame).await,
        RoutedAction::Data {
            request_id, frame, ..
        } => match frame.get("operation").and_then(Value::as_str) {
            Some("list_files") => {
                let workspace_id = frame
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
                let relative_path = frame
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let entries = state
                    .data
                    .list_files(workspace_id, relative_path)
                    .map_err(host_data_error)?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "list_files",
                    "entries": entries,
                }))
            }
            Some("list_sessions") => {
                let workspace_id = frame
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
                let sessions = state
                    .data
                    .list_sessions(workspace_id)
                    .map_err(host_data_error)?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "list_sessions",
                    "sessions": sessions,
                }))
            }
            Some("list_all_sessions") => {
                let workspace_id = frame
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
                let sessions = state
                    .data
                    .list_all_sessions(workspace_id)
                    .map_err(host_data_error)?;
                let mut sessions = serde_json::to_value(sessions)
                    .map_err(|error| ("serialization_failed", error.to_string()))?;
                if let Ok(statuses) = state.runtimes.statuses() {
                    annotate_live_sessions(&mut sessions, statuses);
                }
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "list_all_sessions",
                    "sessions": sessions,
                }))
            }
            Some("search_sessions") => {
                let workspace_id = frame
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
                let query = frame.get("query").and_then(Value::as_str).unwrap_or("");
                let results = state
                    .data
                    .search_sessions(workspace_id, query)
                    .map_err(host_data_error)?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "search_sessions",
                    "results": results,
                }))
            }
            Some("cost_dashboard") => {
                let workspace_id = frame
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
                let dashboard = state
                    .data
                    .cost_dashboard(workspace_id)
                    .map_err(host_data_error)?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "cost_dashboard",
                    "dashboard": dashboard,
                }))
            }
            Some("read_session_messages") => {
                let workspace_id = frame
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
                let session_id = frame
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_session", "sessionId is required".into()))?;
                let messages = state
                    .data
                    .read_session_messages(workspace_id, session_id)
                    .map_err(host_data_error)?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "read_session_messages",
                    "messages": messages,
                }))
            }
            Some("workspace_info") => {
                let workspace_id = frame
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
                let info = state
                    .data
                    .workspace_info(workspace_id)
                    .map_err(host_data_error)?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "workspace_info",
                    "info": info,
                }))
            }
            _ => Err((
                "unknown_data_operation",
                "Unsupported data operation".into(),
            )),
        },
        RoutedAction::Subscribe { request_id, .. } => Ok(json!({
            "type": "runtime_subscribed",
            "requestId": request_id,
        })),
    }
}

async fn dispatch_host_operation(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    match operation {
        "list_pi_packages" => {
            let resolver = state.pi_launch.clone();
            let sources = tokio::task::spawn_blocking(move || resolver.list_pi_packages())
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("list_pi_packages_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "list_pi_packages",
                "packages": sources,
            }))
        }
        "install_pi_package" | "remove_pi_package" => {
            let source = frame
                .get("source")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(("invalid_source", "Package source cannot be empty".into()))?
                .to_owned();
            let resolver = state.pi_launch.clone();
            let is_install = operation == "install_pi_package";
            tokio::task::spawn_blocking(move || {
                if is_install {
                    resolver.install_pi_package(&source)
                } else {
                    resolver.remove_pi_package(&source)
                }
            })
            .await
            .map_err(|error| ("host_operation_failed", error.to_string()))?
            .map_err(|message| {
                if is_install {
                    ("install_pi_package_failed", message)
                } else {
                    ("remove_pi_package_failed", message)
                }
            })?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": operation,
                "ok": true,
            }))
        }
        "list_installed_apps" => Ok(json!({
            "type": "host_response",
            "requestId": request_id,
            "operation": "list_installed_apps",
            "apps": list_installed_apps(),
        })),
        "open_in_app" => {
            let path = frame
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(("invalid_path", "path is required".into()))?;
            let app_name = frame
                .get("appName")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let command = frame
                .get("command")
                .and_then(Value::as_str)
                .map(str::to_owned);
            tokio::task::spawn_blocking(move || {
                open_in_app(&path, app_name.as_deref(), command.as_deref())
            })
            .await
            .map_err(|error| ("host_operation_failed", error.to_string()))?
            .map_err(|message| ("open_in_app_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "open_in_app",
                "ok": true,
            }))
        }
        "open_external" => {
            let url = frame
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(("invalid_url", "url is required".into()))?;
            tokio::task::spawn_blocking(move || open_external(&url))
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("open_external_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "open_external",
                "ok": true,
            }))
        }
        "delete_sessions" => {
            let session_ids: Vec<String> = frame
                .get("sessionIds")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let data = state.data.clone();
            let result = tokio::task::spawn_blocking(move || data.delete_sessions(&session_ids))
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(host_data_error)?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "delete_sessions",
                "deleted": result.deleted,
                "errors": result.errors,
            }))
        }
        _ => Err((
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2".into(),
        )),
    }
}

fn host_data_error(error: HostDataError) -> (&'static str, String) {
    match error {
        HostDataError::UnknownWorkspace => {
            ("workspace_not_found", "Workspace is not registered".into())
        }
        HostDataError::InvalidRelativePath | HostDataError::OutsideWorkspace => (
            "path_outside_workspace",
            "Requested path is outside the registered workspace".into(),
        ),
        HostDataError::NotDirectory => (
            "not_a_directory",
            "Requested path is not a directory".into(),
        ),
        HostDataError::Io(message) => ("file_access_failed", message),
    }
}

fn host_data_http_error(error: HostDataError) -> (StatusCode, Json<Value>) {
    let status = match error {
        HostDataError::UnknownWorkspace => StatusCode::NOT_FOUND,
        HostDataError::InvalidRelativePath
        | HostDataError::OutsideWorkspace
        | HostDataError::NotDirectory => StatusCode::BAD_REQUEST,
        HostDataError::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    let (code, _) = host_data_error(error);
    api_error(status, code)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairingExchangeRequest {
    pairing_token: String,
    device_id: String,
    #[serde(default)]
    device_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingExchangeResponse {
    device_token: String,
}

async fn exchange_pairing(
    State(state): State<Arc<HostState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(request): Json<PairingExchangeRequest>,
) -> Result<Json<PairingExchangeResponse>, (StatusCode, Json<Value>)> {
    log::info!(
        "[pairing] exchange attempt token={} device={} peer={}",
        &request.pairing_token[..request.pairing_token.len().min(12)],
        &request.device_id,
        peer.ip()
    );
    let token = state
        .auth
        .lock()
        .map_err(|_| api_error(StatusCode::SERVICE_UNAVAILABLE, "auth_unavailable"))?
        .exchange_from(
            peer.ip(),
            &request.pairing_token,
            &request.device_id,
            &request.device_name,
            now_seconds(),
        )
        .map_err(|error| match error {
            PairingError::RateLimited { .. } => {
                api_error(StatusCode::TOO_MANY_REQUESTS, "pairing_rate_limited")
            }
            PairingError::InvalidDevice => api_error(StatusCode::BAD_REQUEST, "invalid_device"),
            PairingError::Storage(_) => {
                api_error(StatusCode::SERVICE_UNAVAILABLE, "auth_unavailable")
            }
            PairingError::InvalidOrUsed | PairingError::Expired => {
                api_error(StatusCode::UNAUTHORIZED, "pairing_rejected")
            }
        })?;
    Ok(Json(PairingExchangeResponse {
        device_token: token,
    }))
}

fn ensure_notes_authorized(
    state: &HostState,
    scene_id: &str,
    _write: bool,
) -> Result<(), (StatusCode, Json<Value>)> {
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    let notes = registry
        .list(scene_id)
        .into_iter()
        .find(|plugin| plugin.manifest.id == "com.zicode.notes")
        .filter(|plugin| plugin.enabled)
        .ok_or_else(|| {
            plugin_api_error(
                StatusCode::FORBIDDEN,
                "plugin_not_enabled",
                "Notes is not enabled in this scene",
            )
        })?;
    if !notes
        .permission_grants
        .get("storage.plugin")
        .copied()
        .unwrap_or(false)
    {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "Notes storage permission is not granted",
        ));
    }
    Ok(())
}

fn ensure_notes_network_permission(
    state: &HostState,
    scene_id: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    let granted = registry
        .list(scene_id)
        .into_iter()
        .find(|plugin| plugin.manifest.id == "com.zicode.notes" && plugin.enabled)
        .and_then(|plugin| plugin.permission_grants.get("network.fetch").copied())
        .unwrap_or(false);
    if !granted {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "Grant Notes network access in Plugin Manager before capturing a web page",
        ));
    }
    Ok(())
}

fn ensure_artifacts_authorized(
    state: &HostState,
    scene_id: &str,
    source_plugin_id: Option<&str>,
) -> Result<(), (StatusCode, Json<Value>)> {
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    let plugins = registry.list(scene_id);
    let artifacts = plugins
        .iter()
        .find(|plugin| plugin.manifest.id == "com.zicode.artifacts")
        .filter(|plugin| plugin.enabled)
        .ok_or_else(|| {
            plugin_api_error(
                StatusCode::FORBIDDEN,
                "plugin_not_enabled",
                "Artifacts is not enabled in this scene",
            )
        })?;
    if !artifacts
        .permission_grants
        .get("storage.plugin")
        .copied()
        .unwrap_or(false)
    {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "Artifacts storage permission is not granted",
        ));
    }
    if let Some(plugin_id) = source_plugin_id {
        let source_enabled = plugins
            .iter()
            .any(|plugin| plugin.manifest.id == plugin_id && plugin.enabled);
        if !source_enabled {
            return Err(plugin_api_error(
                StatusCode::FORBIDDEN,
                "source_plugin_not_enabled",
                "The source plugin is not enabled in this scene",
            ));
        }
    }
    Ok(())
}

fn notes_unavailable() -> (StatusCode, Json<Value>) {
    notes_api_error(NotesError {
        code: "storage_unavailable",
        message: "Notes vault is unavailable".into(),
    })
}

fn artifacts_unavailable() -> (StatusCode, Json<Value>) {
    artifacts_api_error(ArtifactError::new(
        "storage_unavailable",
        "Artifacts store is unavailable",
    ))
}

fn artifacts_api_error(error: ArtifactError) -> (StatusCode, Json<Value>) {
    let status = match error.code {
        "invalid_parameters" => StatusCode::BAD_REQUEST,
        "artifact_not_found" => StatusCode::NOT_FOUND,
        "version_conflict" => StatusCode::CONFLICT,
        "payload_too_large" | "quota_exceeded" => StatusCode::PAYLOAD_TOO_LARGE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    plugin_api_error(status, error.code, &error.message)
}

fn notes_api_error(error: NotesError) -> (StatusCode, Json<Value>) {
    let status = match error.code {
        "invalid_parameters" => StatusCode::BAD_REQUEST,
        "notebook_not_found" | "note_not_found" | "attachment_not_found" => StatusCode::NOT_FOUND,
        "version_conflict" | "conflict" => StatusCode::CONFLICT,
        "payload_too_large" | "quota_exceeded" => StatusCode::PAYLOAD_TOO_LARGE,
        "permission_denied" => StatusCode::FORBIDDEN,
        "capture_blocked" => StatusCode::FORBIDDEN,
        "capture_failed" => StatusCode::BAD_GATEWAY,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    plugin_api_error(status, error.code, &error.message)
}

struct CapturedPage {
    title: String,
    markdown: String,
    final_url: String,
    author: Option<String>,
    published_at: Option<String>,
}

async fn fetch_capture_source(raw_url: &str) -> Result<CapturedPage, NotesError> {
    const MAX_CAPTURE_BYTES: usize = 2 * 1024 * 1024;
    const MAX_REDIRECTS: usize = 5;
    let mut url = reqwest::Url::parse(raw_url)
        .map_err(|_| NotesError::new("invalid_parameters", "Enter a valid HTTP(S) URL"))?;
    for redirect_count in 0..=MAX_REDIRECTS {
        let addresses = validate_capture_url(&url).await?;
        let host = url
            .host_str()
            .ok_or_else(|| NotesError::new("capture_blocked", "URL host is missing"))?;
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .user_agent("ZiCode-Notes-Capture/1.0");
        if !addresses.is_empty() && host.parse::<IpAddr>().is_err() {
            builder = builder.resolve_to_addrs(host, &addresses);
        }
        let client = builder
            .build()
            .map_err(|_| NotesError::new("capture_failed", "Cannot initialize web capture"))?;
        let response = client
            .get(url.clone())
            .header(
                reqwest::header::ACCEPT,
                "text/html, text/plain;q=0.8, application/xhtml+xml;q=0.7",
            )
            .send()
            .await
            .map_err(|_| NotesError::new("capture_failed", "Cannot retrieve the web page"))?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(NotesError::new(
                    "capture_failed",
                    "The web page redirected too many times",
                ));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| {
                    NotesError::new(
                        "capture_failed",
                        "The web page returned an invalid redirect",
                    )
                })?;
            url = url
                .join(location)
                .map_err(|_| NotesError::new("capture_failed", "Redirect URL is invalid"))?;
            continue;
        }
        if !response.status().is_success() {
            return Err(NotesError::new(
                "capture_failed",
                format!("The web page returned HTTP {}", response.status().as_u16()),
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_CAPTURE_BYTES as u64)
        {
            return Err(NotesError::new(
                "payload_too_large",
                "The web page exceeds the 2 MiB capture limit",
            ));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        if !content_type.is_empty()
            && !content_type.starts_with("text/html")
            && !content_type.starts_with("text/plain")
            && !content_type.starts_with("application/xhtml+xml")
        {
            return Err(NotesError::new(
                "capture_blocked",
                "Only HTML and plain-text pages can be captured",
            ));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|_| NotesError::new("capture_failed", "Web page download failed"))?;
            if bytes.len().saturating_add(chunk.len()) > MAX_CAPTURE_BYTES {
                return Err(NotesError::new(
                    "payload_too_large",
                    "The web page exceeds the 2 MiB capture limit",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        let text = String::from_utf8(bytes)
            .map_err(|_| NotesError::new("capture_failed", "The web page is not UTF-8 text"))?;
        let is_plain = content_type.starts_with("text/plain");
        let title = if is_plain {
            url.path_segments()
                .and_then(|segments| segments.filter(|value| !value.is_empty()).next_back())
                .unwrap_or(host)
                .to_string()
        } else {
            extract_tag_text(&text, "title")
                .map(|value| decode_html_entities(&value))
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| host.to_string())
        };
        let markdown = if is_plain {
            text.trim().to_string()
        } else {
            html_to_markdown(&text)
        };
        if markdown.trim().is_empty() {
            return Err(NotesError::new(
                "capture_failed",
                "No readable page content was found",
            ));
        }
        return Ok(CapturedPage {
            title: title.trim().chars().take(200).collect(),
            markdown,
            final_url: url.to_string(),
            author: extract_meta_content(&text, &["author", "article:author"]),
            published_at: extract_meta_content(
                &text,
                &[
                    "article:published_time",
                    "date",
                    "datePublished",
                    "publishdate",
                ],
            ),
        });
    }
    Err(NotesError::new(
        "capture_failed",
        "The web page could not be captured",
    ))
}

async fn validate_capture_url(url: &reqwest::Url) -> Result<Vec<std::net::SocketAddr>, NotesError> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(NotesError::new(
            "capture_blocked",
            "Only credential-free HTTP(S) URLs are allowed",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| NotesError::new("capture_blocked", "URL host is missing"))?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err(NotesError::new(
            "capture_blocked",
            "Loopback and private network URLs are not allowed",
        ));
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| NotesError::new("capture_blocked", "URL port is invalid"))?;
    let addresses = if let Ok(address) = host.parse::<IpAddr>() {
        vec![std::net::SocketAddr::new(address, port)]
    } else {
        tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| NotesError::new("capture_failed", "Cannot resolve the web page host"))?
            .collect::<Vec<_>>()
    };
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(NotesError::new(
            "capture_blocked",
            "Loopback and private network URLs are not allowed",
        ));
    }
    Ok(addresses)
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let [a, b, c, _] = address.octets();
            !(address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_multicast()
                || address.is_broadcast()
                || a == 0
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || (a == 198 && (18..=19).contains(&b)))
        }
        IpAddr::V6(address) => {
            let first = address.segments()[0];
            !(address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80)
        }
    }
}

fn extract_tag_text(html: &str, tag: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let open = format!("<{tag}");
    let start = lower.find(&open)?;
    let content_start = lower[start..].find('>')? + start + 1;
    let close = format!("</{tag}>");
    let end = lower[content_start..].find(&close)? + content_start;
    Some(
        strip_html_tags(&html[content_start..end])
            .trim()
            .to_string(),
    )
}

fn extract_meta_content(html: &str, names: &[&str]) -> Option<String> {
    let lower = html.to_lowercase();
    let mut offset = 0usize;
    while let Some(relative) = lower[offset..].find("<meta") {
        let start = offset + relative;
        let end = lower[start..].find('>')? + start + 1;
        let tag = &html[start..end];
        let name = html_attribute(tag, "name").or_else(|| html_attribute(tag, "property"));
        if name.as_ref().is_some_and(|value| {
            names
                .iter()
                .any(|candidate| value.eq_ignore_ascii_case(candidate))
        }) {
            return html_attribute(tag, "content")
                .map(|value| decode_html_entities(&value))
                .filter(|value| !value.trim().is_empty());
        }
        offset = end;
    }
    None
}

fn html_attribute(tag: &str, attribute: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let mut offset = 0usize;
    while let Some(relative) = lower[offset..].find(attribute) {
        let start = offset + relative;
        let before_ok = start == 0 || !lower.as_bytes()[start - 1].is_ascii_alphanumeric();
        let mut cursor = start + attribute.len();
        while lower
            .as_bytes()
            .get(cursor)
            .is_some_and(u8::is_ascii_whitespace)
        {
            cursor += 1;
        }
        if before_ok && lower.as_bytes().get(cursor) == Some(&b'=') {
            cursor += 1;
            while lower
                .as_bytes()
                .get(cursor)
                .is_some_and(u8::is_ascii_whitespace)
            {
                cursor += 1;
            }
            let quote = *tag.as_bytes().get(cursor)?;
            if matches!(quote, b'"' | b'\'') {
                cursor += 1;
                let end = tag[cursor..].find(quote as char)? + cursor;
                return Some(tag[cursor..end].to_string());
            }
        }
        offset = start + attribute.len();
    }
    None
}

fn html_to_markdown(html: &str) -> String {
    let cleaned = remove_html_blocks(html, &["script", "style", "noscript", "svg", "nav"]);
    let mut output = String::new();
    let mut cursor = 0usize;
    while cursor < cleaned.len() {
        let Some(relative) = cleaned[cursor..].find('<') else {
            output.push_str(&cleaned[cursor..]);
            break;
        };
        let start = cursor + relative;
        output.push_str(&cleaned[cursor..start]);
        let Some(end_relative) = cleaned[start..].find('>') else {
            break;
        };
        let end = start + end_relative + 1;
        let raw = cleaned[start + 1..end - 1].trim();
        let closing = raw.starts_with('/');
        let name = raw
            .trim_start_matches('/')
            .split(|character: char| character.is_ascii_whitespace() || character == '/')
            .next()
            .unwrap_or("")
            .to_lowercase();
        match (closing, name.as_str()) {
            (false, "h1") => output.push_str("\n\n# "),
            (false, "h2") => output.push_str("\n\n## "),
            (false, "h3") => output.push_str("\n\n### "),
            (false, "h4") => output.push_str("\n\n#### "),
            (false, "li") => output.push_str("\n- "),
            (false, "br") => output.push('\n'),
            (true, "p" | "div" | "article" | "section" | "blockquote")
            | (true, "h1" | "h2" | "h3" | "h4" | "li" | "ul" | "ol") => output.push_str("\n\n"),
            _ => {}
        }
        cursor = end;
    }
    normalize_markdown_whitespace(&decode_html_entities(&output))
}

fn remove_html_blocks(html: &str, tags: &[&str]) -> String {
    let mut result = html.to_string();
    for tag in tags {
        loop {
            let lower = result.to_lowercase();
            let Some(start) = lower.find(&format!("<{tag}")) else {
                break;
            };
            let Some(relative_end) = lower[start..].find(&format!("</{tag}>")) else {
                result.truncate(start);
                break;
            };
            let end = start + relative_end + tag.len() + 3;
            result.replace_range(start..end, "");
        }
    }
    result
}

fn strip_html_tags(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(character),
            _ => {}
        }
    }
    output
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn normalize_markdown_whitespace(value: &str) -> String {
    let mut output = String::new();
    let mut blank_lines = 0usize;
    for line in value.lines() {
        let line = line.trim();
        if line.is_empty() {
            blank_lines += 1;
            if blank_lines <= 1 && !output.is_empty() {
                output.push('\n');
            }
            continue;
        }
        blank_lines = 0;
        output.push_str(line);
        output.push('\n');
    }
    output.trim().to_string()
}

fn api_error(status: StatusCode, code: &'static str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": { "code": code } })))
}

fn plugin_api_error(
    status: StatusCode,
    code: &'static str,
    message: &str,
) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({ "error": { "code": code, "message": message } })),
    )
}

fn capability_api_error(error: CapabilityError) -> (StatusCode, Json<Value>) {
    let status = match error.code {
        "invalid_parameters" => StatusCode::BAD_REQUEST,
        "payload_too_large" | "result_too_large" => StatusCode::PAYLOAD_TOO_LARGE,
        "capability_unavailable" | "command_not_available" | "plugin_not_active" => {
            StatusCode::NOT_FOUND
        }
        "idempotency_conflict" => StatusCode::CONFLICT,
        "storage_unavailable" | "serialization_failed" => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    plugin_api_error(status, error.code, &error.message)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

async fn send_error(
    socket: &mut WebSocket,
    request_id: Option<&str>,
    code: &'static str,
    message: &str,
) -> Result<(), axum::Error> {
    socket
        .send(Message::Text(
            structured_error(request_id, code, message)
                .to_string()
                .into(),
        ))
        .await
}

fn structured_error(request_id: Option<&str>, code: &'static str, message: &str) -> Value {
    json!({
        "type": "error",
        "requestId": request_id,
        "error": { "code": code, "message": message },
    })
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::{
        extension_ui_requires_owner, html_to_markdown, is_public_ip, lan_qr_issuer_allowed,
        messages_from_entries_response, public_remote_path, remote_http_authorized,
        rewrite_developer_roles, websocket_origin_allowed, HostServer,
    };
    use crate::metadata_store::MetadataStore;
    use crate::native_pi_manager::NativePiManager;
    use crate::remote_auth::RemoteAuth;
    use crate::runtime_coordinator::RuntimeTarget;
    use axum::body::Bytes;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use std::collections::HashSet;
    use std::fs;
    use std::net::{IpAddr, Ipv4Addr};
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tokio::sync::mpsc;

    #[test]
    fn rewrites_developer_roles_to_system_before_forwarding() {
        let body = Bytes::from(
            r#"{"model":"deepseek-v4-flash","messages":[{"role":"developer","content":"x"},{"role":"user","content":"hi"}]}"#,
        );
        let rewritten = rewrite_developer_roles(&body).unwrap();
        let value: Value = serde_json::from_slice(&rewritten).unwrap();
        let roles: Vec<&str> = value["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|message| message["role"].as_str().unwrap())
            .collect();
        assert_eq!(roles, vec!["system", "user"]);
    }

    async fn remove_temp_dir_when_released(path: &Path) {
        let mut last_error = None;
        for _ in 0..20 {
            match fs::remove_dir_all(path) {
                Ok(()) => return,
                Err(error) => {
                    last_error = Some(error);
                    tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                }
            }
        }
        panic!(
            "temporary host directory remained locked: {}: {:?}",
            path.display(),
            last_error
        );
    }

    #[test]
    fn requires_an_exact_allowed_origin_for_remote_websockets() {
        let allowed = HashSet::from([
            "http://127.0.0.1:57620".to_string(),
            "https://192.168.1.20:57621".to_string(),
        ]);
        let remote = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 42));
        let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
        let mut headers = axum::http::HeaderMap::new();

        assert!(websocket_origin_allowed(loopback, &headers, &allowed));
        assert!(!websocket_origin_allowed(remote, &headers, &allowed));
        headers.insert(
            axum::http::header::ORIGIN,
            "https://192.168.1.20:57621".parse().unwrap(),
        );
        assert!(websocket_origin_allowed(remote, &headers, &allowed));
        headers.insert(
            axum::http::header::ORIGIN,
            "https://192.168.1.20:57621.evil.example".parse().unwrap(),
        );
        assert!(!websocket_origin_allowed(remote, &headers, &allowed));
    }

    #[test]
    fn requires_a_paired_device_token_for_non_loopback_http_api_requests() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-http-auth-{nonce}"));
        fs::create_dir_all(&temp).unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let pairing = auth.lock().unwrap().create_pairing(1_000);
        let token = auth
            .lock()
            .unwrap()
            .exchange(&pairing.token, "phone", "Phone", 1_001)
            .unwrap();
        let remote = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20));
        let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
        let mut headers = axum::http::HeaderMap::new();

        assert!(!remote_http_authorized(&auth, remote, &headers));
        assert!(remote_http_authorized(&auth, loopback, &headers));
        headers.insert(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        assert!(remote_http_authorized(&auth, remote, &headers));
        assert!(public_remote_path("/health"));
        assert!(public_remote_path("/v2/auth/exchange"));
        assert!(!public_remote_path("/v2/bootstrap"));

        drop(auth);
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn only_a_loopback_desktop_client_may_issue_mobile_qr_credentials() {
        assert!(lan_qr_issuer_allowed(IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(lan_qr_issuer_allowed(IpAddr::V6(
            std::net::Ipv6Addr::LOCALHOST
        )));
        assert!(!lan_qr_issuer_allowed(IpAddr::V4(Ipv4Addr::new(
            192, 168, 1, 20
        ))));
    }

    #[test]
    fn only_blocking_extension_ui_requests_require_the_session_owner() {
        assert!(extension_ui_requires_owner(&json!({
            "type": "extension_ui_request",
            "method": "select"
        })));
        assert!(!extension_ui_requires_owner(&json!({
            "type": "extension_ui_request",
            "method": "notify",
            "message": "{\"__picotConfig\":\"cfg-1\",\"ok\":true}"
        })));
        assert!(!extension_ui_requires_owner(&json!({
            "type": "agent_start"
        })));
    }

    #[test]
    fn derives_active_branch_messages_with_user_entry_ids_from_entries() {
        let response = json!({
            "type": "response",
            "command": "get_entries",
            "success": true,
            "data": {
                "leafId": "assistant-2",
                "entries": [
                    {
                        "type": "message",
                        "id": "user-1",
                        "parentId": null,
                        "message": { "role": "user", "content": "first" }
                    },
                    {
                        "type": "message",
                        "id": "assistant-1",
                        "parentId": "user-1",
                        "message": { "role": "assistant", "content": [{ "type": "text", "text": "old" }] }
                    },
                    {
                        "type": "message",
                        "id": "user-abandoned",
                        "parentId": "assistant-1",
                        "message": { "role": "user", "content": "abandoned" }
                    },
                    {
                        "type": "message",
                        "id": "user-2",
                        "parentId": "assistant-1",
                        "message": { "role": "user", "content": "current" }
                    },
                    {
                        "type": "message",
                        "id": "assistant-2",
                        "parentId": "user-2",
                        "message": { "role": "assistant", "content": [{ "type": "text", "text": "new" }] }
                    }
                ]
            }
        });

        let messages = messages_from_entries_response(&response);

        assert_eq!(
            messages,
            json!([
                { "role": "user", "content": "first", "entryId": "user-1" },
                { "role": "assistant", "content": [{ "type": "text", "text": "old" }] },
                { "role": "user", "content": "current", "entryId": "user-2" },
                { "role": "assistant", "content": [{ "type": "text", "text": "new" }] }
            ])
        );
    }

    #[test]
    fn web_capture_sanitizes_active_html_and_rejects_private_network_addresses() {
        let markdown = html_to_markdown(
            r#"<main><h1>Public title</h1><script>alert("secret")</script><p>Readable <strong>text</strong>.</p></main>"#,
        );
        assert!(markdown.contains("# Public title"));
        assert!(markdown.contains("Readable text."));
        assert!(!markdown.contains("alert"));
        assert!(!is_public_ip("127.0.0.1".parse().unwrap()));
        assert!(!is_public_ip("10.2.3.4".parse().unwrap()));
        assert!(!is_public_ip("::1".parse().unwrap()));
        assert!(is_public_ip("1.1.1.1".parse().unwrap()));
    }

    #[tokio::test]
    async fn serves_health_and_static_assets_from_one_origin() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-host-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(
            public.join("index.html"),
            "<h1>ZiCode Studio Desktop native host</h1>",
        )
        .unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();

        let health_response = client
            .get(format!("{}/health", host.origin()))
            .send()
            .await
            .unwrap();
        let health_status = health_response.status();
        let health_body = health_response.text().await.unwrap();
        assert_eq!(
            health_status,
            reqwest::StatusCode::OK,
            "unexpected health response from {}: {health_body:?}",
            host.origin()
        );
        let health: serde_json::Value = serde_json::from_str(&health_body)
            .unwrap_or_else(|error| panic!("invalid health response {health_body:?}: {error}"));
        assert_eq!(health["protocolVersion"], 2);
        assert_eq!(health["piVersion"], env!("PI_STUDIO_PI_VERSION_BUNDLED"));
        assert_eq!(health["lanUrl"], "");
        assert_eq!(health["lanAccessEnabled"], false);
        let index = client
            .get(format!("{}/app/settings", host.origin()))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(index.contains("ZiCode Studio Desktop native host"));

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn manages_scene_specific_plugin_state_through_the_host_api() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("zicode-host-plugins-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();

        let before: serde_json::Value = client
            .get(format!("{}/v2/plugins?sceneId=programming", host.origin()))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(before["plugins"].as_array().unwrap().len(), 7);
        assert!(before["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .any(|plugin| plugin["id"] == "core.chat"));

        let response = client
            .post(format!("{}/v2/plugins/enablement", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "pluginId": "com.zicode.notes",
                "enabled": false
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);

        let after: serde_json::Value = client
            .get(format!("{}/v2/plugins?sceneId=programming", host.origin()))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let notes = after["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .find(|plugin| plugin["id"] == "com.zicode.notes")
            .unwrap();
        assert_eq!(notes["enabled"], false);

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn serves_only_enabled_declared_developer_views_through_the_host_api() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("zicode-host-plugin-view-{nonce}"));
        let public = temp.join("public");
        let package = temp.join("test-plugin-registry/developer/com.example.view");
        fs::create_dir_all(package.join("views")).unwrap();
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        fs::write(
            package.join("plugin.json"),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "id": "com.example.view",
                "name": "Example View",
                "description": "Sandboxed view contract test",
                "version": "1.0.0",
                "publisher": "example",
                "contributes": {
                    "activities": [{ "id": "example", "title": "Example", "order": 10 }],
                    "views": [{
                        "id": "example.main",
                        "activity": "example",
                        "location": "main",
                        "title": "Example",
                        "entry": "views/main.html"
                    }]
                }
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(
            package.join("views/main.html"),
            "<main><h1>Developer sandbox</h1></main>",
        )
        .unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let source_url = format!(
            "{}/v2/plugin-views/source?sceneId=programming&pluginId=com.example.view&viewId=example.main",
            host.origin()
        );

        let disabled = client.get(&source_url).send().await.unwrap();
        assert_eq!(disabled.status(), reqwest::StatusCode::FORBIDDEN);
        let enabled = client
            .post(format!("{}/v2/plugins/enablement", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "pluginId": "com.example.view",
                "enabled": true
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(enabled.status(), reqwest::StatusCode::OK);

        let document: serde_json::Value = client
            .get(&source_url)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(document["view"]["viewId"], "example.main");
        assert_eq!(document["view"]["location"], "main");
        assert!(document["view"]["html"]
            .as_str()
            .unwrap()
            .contains("Developer sandbox"));

        let other_scene = client
            .get(source_url.replace("sceneId=programming", "sceneId=finance"))
            .send()
            .await
            .unwrap();
        assert_eq!(other_scene.status(), reqwest::StatusCode::FORBIDDEN);

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn manages_markdown_notes_with_optimistic_versions_through_the_host_api() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("zicode-host-notes-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();

        let notebook: serde_json::Value = client
            .post(format!("{}/v2/notes/notebooks", host.origin()))
            .json(&json!({ "sceneId": "programming", "title": "Product Notes" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let notebook_id = notebook["notebook"]["id"].as_str().unwrap();
        assert!(temp
            .join("plugin-data/com.zicode.notes/vaults")
            .join(notebook_id)
            .join("astro.config.mjs")
            .is_file());

        let created: serde_json::Value = client
            .post(format!("{}/v2/notes/create", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "notebookId": notebook_id,
                "title": "P5 roadmap",
                "content": "The searchable body contains capability broker.",
                "tags": ["plugin", "roadmap"]
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let note_id = created["note"]["id"].as_str().unwrap();
        let version = created["note"]["version"].as_str().unwrap();

        let searched: serde_json::Value = client
            .get(format!(
                "{}/v2/notes?sceneId=programming&query=capability%20broker",
                host.origin()
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(searched["snapshot"]["notes"][0]["id"], note_id);

        let saved: serde_json::Value = client
            .post(format!("{}/v2/notes/save", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "notebookId": notebook_id,
                "noteId": note_id,
                "title": "P5 roadmap",
                "content": "Updated Markdown body.",
                "tags": ["plugin"],
                "expectedVersion": version
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_ne!(saved["note"]["version"], version);

        let uploaded: serde_json::Value = client
            .post(format!("{}/v2/notes/attachments", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "notebookId": notebook_id,
                "noteId": note_id,
                "fileName": "proof.txt",
                "mimeType": "text/plain",
                "dataBase64": "aGVsbG8="
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let attachment_id = uploaded["attachment"]["id"].as_str().unwrap();
        let attachment_response = client
            .get(format!(
                "{}/v2/notes/attachment?sceneId=programming&notebookId={notebook_id}&noteId={note_id}&attachmentId={attachment_id}",
                host.origin()
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(attachment_response.headers()["content-type"], "text/plain");
        assert_eq!(
            attachment_response.bytes().await.unwrap().as_ref(),
            b"hello"
        );

        let exported: serde_json::Value = client
            .get(format!(
                "{}/v2/notes/export?sceneId=programming&notebookId={notebook_id}",
                host.origin()
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(exported["backup"]["notes"].as_array().unwrap().len(), 1);
        assert_eq!(
            exported["backup"]["attachments"].as_array().unwrap().len(),
            1
        );
        let imported: serde_json::Value = client
            .post(format!("{}/v2/notes/import-backup", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "backup": exported["backup"].clone()
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(imported["notebook"]["title"], "Product Notes (Imported)");

        let rebuilt: serde_json::Value = client
            .post(format!("{}/v2/notes/rebuild", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "notebookId": notebook_id
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(rebuilt["report"]["validNotes"], 1);

        let conflict = client
            .post(format!("{}/v2/notes/save", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "notebookId": notebook_id,
                "noteId": note_id,
                "title": "Stale edit",
                "content": "Must not overwrite.",
                "tags": [],
                "expectedVersion": version
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(conflict.status(), reqwest::StatusCode::CONFLICT);
        let conflict_body: serde_json::Value = conflict.json().await.unwrap();
        assert_eq!(conflict_body["error"]["code"], "version_conflict");

        let markdown_path = temp
            .join("plugin-data/com.zicode.notes/vaults")
            .join(notebook_id)
            .join("src/content/notes")
            .join(format!("{note_id}.md"));
        let markdown = fs::read_to_string(markdown_path).unwrap();
        assert!(markdown.contains("Updated Markdown body."));
        assert!(!markdown.contains("Must not overwrite."));

        let private_capture = client
            .post(format!("{}/v2/notes/capture", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "notebookId": notebook_id,
                "url": "http://127.0.0.1/private"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(private_capture.status(), reqwest::StatusCode::FORBIDDEN);

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn manages_scene_scoped_artifacts_with_opaque_handles_through_the_host_api() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("zicode-host-artifacts-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();

        let created: serde_json::Value = client
            .post(format!("{}/v2/artifacts/create", host.origin()))
            .json(&json!({
                "sceneId": "finance",
                "pluginId": "com.zicode.finance",
                "kind": "report",
                "title": "Deterministic backtest",
                "summary": "Local engine result",
                "mimeType": "application/json",
                "provenance": { "engine": "finance.backtest.local", "seed": 7 },
                "content": { "metrics": { "totalReturn": 0.12 } }
            }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let artifact = &created["artifact"];
        let artifact_id = artifact["id"].as_str().unwrap();
        let version = artifact["version"].as_str().unwrap();
        let handle = artifact["handle"].as_str().unwrap();
        assert_eq!(handle, format!("artifact:{artifact_id}"));
        assert!(!handle.contains(&temp.to_string_lossy().to_string()));
        assert!(temp
            .join("plugin-data/com.zicode.artifacts/items")
            .join(format!("{artifact_id}.json"))
            .is_file());

        let listed: serde_json::Value = client
            .get(format!(
                "{}/v2/artifacts?sceneId=finance&kind=report&pluginId=com.zicode.finance&query=backtest",
                host.origin()
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(listed["snapshot"]["artifacts"][0]["id"], artifact_id);

        let read: serde_json::Value = client
            .get(format!(
                "{}/v2/artifacts/item?sceneId=finance&artifactId={artifact_id}",
                host.origin()
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(read["artifact"]["content"]["metrics"]["totalReturn"], 0.12);

        let stale = client
            .post(format!("{}/v2/artifacts/delete", host.origin()))
            .json(&json!({
                "sceneId": "finance",
                "artifactId": artifact_id,
                "expectedVersion": "sha256:stale"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(stale.status(), reqwest::StatusCode::CONFLICT);

        let deleted = client
            .post(format!("{}/v2/artifacts/delete", host.origin()))
            .json(&json!({
                "sceneId": "finance",
                "artifactId": artifact_id,
                "expectedVersion": version
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(deleted.status(), reqwest::StatusCode::OK);

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn lists_and_invokes_authorized_capabilities_through_the_host_api() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("zicode-host-capabilities-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let vault_id = "11111111-1111-4111-8111-111111111111";
        let note_root = temp
            .join("plugin-data/com.zicode.notes/vaults")
            .join(vault_id)
            .join("src/content/notes");
        fs::create_dir_all(&note_root).unwrap();
        fs::write(
            note_root.join("broker.md"),
            "---\nid: \"22222222-2222-4222-8222-222222222222\"\ntitle: \"Broker design\"\n---\n\nCapability Registry is Host-authoritative.",
        )
        .unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();

        let listed: serde_json::Value = client
            .get(format!(
                "{}/v2/plugin-capabilities?sceneId=programming",
                host.origin()
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(listed["capabilities"][0]["id"], "notes.search");

        let response = client
            .post(format!("{}/v2/plugin-capabilities/invoke", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "pluginId": "com.zicode.notes",
                "capabilityId": "notes.search",
                "input": { "query": "authoritative" }
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let body: serde_json::Value = response.json().await.unwrap();
        assert_eq!(body["result"]["matches"][0]["title"], "Broker design");
        assert_eq!(
            body["result"]["matches"][0]["path"],
            format!("{vault_id}/src/content/notes/broker.md")
        );

        let unavailable = client
            .post(format!("{}/v2/plugin-commands/invoke", host.origin()))
            .json(&json!({
                "sceneId": "programming",
                "commandId": "missing.command",
                "args": {}
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(unavailable.status(), reqwest::StatusCode::NOT_FOUND);

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn installs_reloads_and_uninstalls_a_developer_plugin_without_removing_source_data() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("zicode-host-plugin-lifecycle-{nonce}"));
        let public = temp.join("public");
        let source = temp.join("source-plugin");
        fs::create_dir_all(&public).unwrap();
        fs::create_dir_all(&source).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        fs::write(
            source.join("plugin.json"),
            serde_json::to_vec_pretty(&json!({
                "schemaVersion": 1,
                "id": "com.example.host-test",
                "name": "Host test",
                "description": "Host API lifecycle test plugin",
                "version": "1.0.0",
                "publisher": "example",
                "contributes": {
                    "commands": [{ "id": "hostTest.run", "title": "Run" }]
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        assert_eq!(
            host.install_developer_plugin(&source).unwrap(),
            "com.example.host-test"
        );
        let client = reqwest::Client::builder().no_proxy().build().unwrap();

        let reload = client
            .post(format!("{}/v2/plugins/reload", host.origin()))
            .json(&json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(reload.status(), reqwest::StatusCode::OK);
        let listed: serde_json::Value = client
            .get(format!("{}/v2/plugins?sceneId=programming", host.origin()))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(listed["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .any(|plugin| plugin["id"] == "com.example.host-test"));

        let uninstalled: serde_json::Value = client
            .post(format!("{}/v2/plugins/uninstall", host.origin()))
            .json(&json!({ "pluginId": "com.example.host-test" }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(uninstalled["uninstalled"], true);
        assert_eq!(uninstalled["dataPreserved"], true);
        assert!(source.join("plugin.json").is_file());

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn sends_runtime_events_only_after_an_explicit_target_subscription() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-host-ws-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let runtimes = NativePiManager::new(32);
        let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
        let mut fake = runtimes.register_in_memory(target.clone()).unwrap();
        let host = HostServer::start(public, runtimes, auth).await.unwrap();
        let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
        let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "hello",
                    "protocolVersion": 2,
                    "clientType": "desktop",
                    "clientId": "desktop-a"
                })
                .to_string(),
            ))
            .await
            .unwrap();
        socket.next().await.unwrap().unwrap();
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "runtime_subscribe",
                    "requestId": "subscribe-1",
                    "target": target,
                })
                .to_string(),
            ))
            .await
            .unwrap();
        socket.next().await.unwrap().unwrap();

        fake.write_frame(json!({ "type": "agent_start" }))
            .await
            .unwrap();
        let event = tokio::time::timeout(std::time::Duration::from_secs(1), socket.next())
            .await
            .expect("subscribed runtime event")
            .unwrap()
            .unwrap();
        let event: serde_json::Value = serde_json::from_str(event.to_text().unwrap()).unwrap();
        assert_eq!(event["type"], "runtime_event");
        assert_eq!(event["target"]["sessionId"], "session-a");
        assert_eq!(event["sequence"], 1);

        drop(socket);
        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn routes_p2p_data_channel_frames_through_the_runtime_pipeline() {
        use bytes::Bytes;
        use tokio_tungstenite::tungstenite::Message as ClientMessage;
        use webrtc::data_channel::data_channel_message::DataChannelMessage;
        use webrtc::data_channel::data_channel_state::RTCDataChannelState;
        use webrtc::peer_connection::configuration::RTCConfiguration;
        use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-host-p2p-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let runtimes = NativePiManager::new(32);
        let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
        let mut fake = runtimes.register_in_memory(target.clone()).unwrap();
        let host = HostServer::start(public, runtimes, auth).await.unwrap();
        let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
        let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
        socket
            .send(ClientMessage::Text(
                json!({
                    "type": "hello",
                    "protocolVersion": 2,
                    "clientType": "desktop",
                    "clientId": "p2p-desktop"
                })
                .to_string(),
            ))
            .await
            .unwrap();
        socket.next().await.unwrap().unwrap();

        // Offerer peer (simulates the phone) with real WebRTC.
        let api = crate::p2p::build_api().unwrap();
        let offerer = Arc::new(
            api.new_peer_connection(RTCConfiguration {
                ..Default::default()
            })
            .await
            .unwrap(),
        );
        let dc = offerer
            .create_data_channel("zicode-p2p", None)
            .await
            .unwrap();
        let (offerer_msg_tx, mut offerer_msg_rx) = mpsc::unbounded_channel::<String>();
        dc.on_message(Box::new(move |message: DataChannelMessage| {
            let offerer_msg_tx = offerer_msg_tx.clone();
            Box::pin(async move {
                if let Ok(text) = String::from_utf8(message.data.to_vec()) {
                    let _ = offerer_msg_tx.send(text);
                }
            })
        }));
        let (offerer_ice_tx, mut offerer_ice_rx) = mpsc::unbounded_channel::<Value>();
        offerer.on_ice_candidate(Box::new(move |candidate| {
            let offerer_ice_tx = offerer_ice_tx.clone();
            Box::pin(async move {
                if let Some(candidate) = candidate {
                    if let Ok(init) = candidate.to_json() {
                        let _ =
                            offerer_ice_tx.send(json!({ "type": "p2p_ice", "candidate": init }));
                    }
                }
            })
        }));

        let offer = offerer.create_offer(None).await.unwrap();
        offerer.set_local_description(offer.clone()).await.unwrap();
        socket
            .send(ClientMessage::Text(
                json!({ "type": "p2p_offer", "sdp": offer.sdp }).to_string(),
            ))
            .await
            .unwrap();

        // Exchange signals through the gateway until the DataChannel opens.
        let mut remote_candidates = Vec::new();
        let connected = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                tokio::select! {
                    incoming = socket.next() => {
                        let Some(Ok(ClientMessage::Text(text))) = incoming else {
                            panic!("gateway WebSocket closed during negotiation");
                        };
                        let frame: Value = serde_json::from_str(&text).unwrap();
                        match frame.get("type").and_then(Value::as_str).unwrap_or_default() {
                            "p2p_answer" => {
                                let sdp = frame.get("sdp").and_then(Value::as_str).unwrap();
                                let description =
                                    RTCSessionDescription::answer(sdp.to_string()).unwrap();
                                offerer.set_remote_description(description).await.unwrap();
                                for candidate in remote_candidates.drain(..) {
                                    let init = crate::p2p::candidate_to_init(&candidate).unwrap();
                                    let _ = offerer.add_ice_candidate(init).await;
                                }
                            }
                            "p2p_ice" => {
                                let candidate = frame.get("candidate").cloned().unwrap();
                                if offerer.remote_description().await.is_some() {
                                    let init = crate::p2p::candidate_to_init(&candidate).unwrap();
                                    let _ = offerer.add_ice_candidate(init).await;
                                } else {
                                    remote_candidates.push(candidate);
                                }
                            }
                            other => panic!("unexpected gateway frame during negotiation: {other}"),
                        }
                    }
                    candidate = offerer_ice_rx.recv() => {
                        if let Some(candidate) = candidate {
                            socket
                                .send(ClientMessage::Text(candidate.to_string()))
                                .await
                                .unwrap();
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_millis(50)) => {}
                }
                if dc.ready_state() == RTCDataChannelState::Open {
                    break;
                }
            }
        })
        .await;
        assert!(
            connected.is_ok(),
            "P2P connection through the gateway did not open"
        );

        // Runtime requests over the DataChannel reach the host router and the
        // response comes back over the DataChannel.
        dc.send(&Bytes::from_static(
            br#"{"type":"runtime_subscribe","requestId":"p2p-sub-1","target":{"workspaceId":"workspace-a","sessionId":"session-a","instanceId":"instance-a"}}"#,
        ))
        .await
        .unwrap();
        let response = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(text) = offerer_msg_rx.recv().await {
                    break text;
                }
            }
        })
        .await
        .expect("no runtime response over the DataChannel");
        let response: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(response["type"], "runtime_subscribed");
        assert_eq!(response["requestId"], "p2p-sub-1");

        // Subscribed runtime events also flow over the DataChannel.
        fake.write_frame(json!({ "type": "agent_start" }))
            .await
            .unwrap();
        let event = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(text) = offerer_msg_rx.recv().await {
                    break text;
                }
            }
        })
        .await
        .expect("no runtime event over the DataChannel");
        let event: Value = serde_json::from_str(&event).unwrap();
        assert_eq!(event["type"], "runtime_event");
        assert_eq!(event["target"]["sessionId"], "session-a");

        drop(socket);
        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn serves_remote_config_with_an_ice_servers_array() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-host-config-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let runtimes = NativePiManager::new(32);
        let host = HostServer::start(public, runtimes, auth).await.unwrap();

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .get(format!("{}/v2/remote-config", host.origin()))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let body: Value = response.json().await.unwrap();
        assert!(
            body["iceServers"].is_array(),
            "remote-config must always expose an iceServers array"
        );

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn rejects_websocket_upgrades_from_a_foreign_web_origin() {
        use tokio_tungstenite::tungstenite::client::IntoClientRequest;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-host-origin-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
        let mut request = ws_url.into_client_request().unwrap();
        request.headers_mut().insert(
            axum::http::header::ORIGIN,
            axum::http::HeaderValue::from_static("https://malicious.example"),
        );

        let error = tokio_tungstenite::connect_async(request).await.unwrap_err();
        match error {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), axum::http::StatusCode::FORBIDDEN);
            }
            other => panic!("expected an HTTP rejection, got {other:?}"),
        }

        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }

    #[tokio::test]
    async fn replays_startup_extension_ui_and_routes_the_owners_response_exactly_once() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("picot-host-dialog-{nonce}"));
        let public = temp.join("public");
        fs::create_dir_all(&public).unwrap();
        fs::write(public.join("index.html"), "ZiCode Studio Desktop").unwrap();
        let metadata = MetadataStore::open(&temp.join("picot.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let runtimes = NativePiManager::new(32);
        let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
        let mut fake = runtimes.register_in_memory(target.clone()).unwrap();
        fake.write_frame(json!({
            "type": "extension_ui_request",
            "id": "dialog-1",
            "method": "select",
            "title": "Project trust",
            "options": ["Trust once", "Open untrusted"]
        }))
        .await
        .unwrap();
        tokio::task::yield_now().await;

        let host = HostServer::start(public, runtimes, auth).await.unwrap();
        let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
        let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "hello",
                    "protocolVersion": 2,
                    "clientType": "desktop",
                    "clientId": "owner"
                })
                .to_string(),
            ))
            .await
            .unwrap();
        socket.next().await.unwrap().unwrap();
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "runtime_subscribe",
                    "requestId": "subscribe",
                    "target": target,
                })
                .to_string(),
            ))
            .await
            .unwrap();
        socket.next().await.unwrap().unwrap();
        let replay = socket.next().await.unwrap().unwrap();
        let replay: serde_json::Value = serde_json::from_str(replay.to_text().unwrap()).unwrap();
        assert_eq!(replay["event"]["id"], "dialog-1");

        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                json!({
                    "type": "runtime_request",
                    "requestId": "dialog-response",
                    "target": target,
                    "command": {
                        "type": "extension_ui_response",
                        "id": "dialog-1",
                        "value": "Trust once"
                    }
                })
                .to_string(),
            ))
            .await
            .unwrap();
        socket.next().await.unwrap().unwrap();
        assert_eq!(
            fake.read_request().await.unwrap(),
            json!({
                "type": "extension_ui_response",
                "id": "dialog-1",
                "value": "Trust once"
            })
        );

        drop(socket);
        drop(fake);
        host.stop();
        remove_temp_dir_when_released(&temp).await;
    }
}
