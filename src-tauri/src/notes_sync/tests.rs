use super::*;
use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{header, Request, Response, StatusCode},
    Router,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tokio::task::JoinHandle;

pub(crate) const VAULT: &str = "6901fd89-5c4c-48ca-a215-d8482ced95e1";

#[derive(Default)]
struct ServerState {
    files: BTreeMap<String, Vec<u8>>,
    requests: Vec<(String, String)>,
    ignore_conditions: bool,
    weak_etags: bool,
    fail_object: bool,
    fail_index: bool,
    race_index: bool,
    lose_commit_response: bool,
    status: Option<u16>,
    redirect: Option<String>,
    read_gate: Option<Arc<tokio::sync::Barrier>>,
}

pub(crate) struct Server {
    url: String,
    state: Arc<Mutex<ServerState>>,
    task: JoinHandle<()>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Server {
    pub(crate) async fn start() -> Self {
        let state = Arc::new(Mutex::new(ServerState::default()));
        let app = Router::new().fallback(handle).with_state(state.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/dav/", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self { url, state, task }
    }
    pub(crate) async fn connect(&self, key: SyncKey) -> Result<SyncRepository, SyncError> {
        SyncRepository::connect(
            &self.url,
            "fixture-user".into(),
            "fixture-password".into(),
            VAULT,
            key,
        )
        .await
    }
    fn index(&self) -> Option<Vec<u8>> {
        self.state.lock().unwrap().files.get(&index_path()).cloned()
    }
    fn writes(&self) -> usize {
        self.state
            .lock()
            .unwrap()
            .requests
            .iter()
            .filter(|(m, p)| m == "PUT" && p.ends_with("index.zns"))
            .count()
    }
}

fn index_path() -> String {
    format!("/dav/zicode-notes/{VAULT}/index.zns")
}

fn respond(status: StatusCode, bytes: Vec<u8>, weak: bool) -> Response<Body> {
    let etag = format!(
        "{}\"{}\"",
        if weak { "W/" } else { "" },
        crypto::digest(&bytes)
    );
    Response::builder()
        .status(status)
        .header(header::ETAG, etag)
        .body(Body::from(bytes))
        .unwrap()
}

async fn handle(
    State(state): State<Arc<Mutex<ServerState>>>,
    request: Request<Body>,
) -> Response<Body> {
    let (parts, body) = request.into_parts();
    let bytes = to_bytes(body, MAX_OBJECT_BYTES + 1024)
        .await
        .unwrap_or_default()
        .to_vec();
    let gated = {
        let mut state = state.lock().unwrap();
        if parts.method == "GET" && parts.uri.path().ends_with("index.zns") {
            state.read_gate.clone().map(|gate| {
                state.requests.push(("GET".into(), parts.uri.path().into()));
                (gate, state.files.get(parts.uri.path()).cloned())
            })
        } else {
            None
        }
    };
    if let Some((gate, current)) = gated {
        gate.wait().await;
        return match current {
            Some(bytes) => respond(StatusCode::OK, bytes, false),
            None => respond(StatusCode::NOT_FOUND, vec![], false),
        };
    }
    let mut state = state.lock().unwrap();
    let path = parts.uri.path().to_string();
    let method = parts.method.as_str();
    state.requests.push((method.to_string(), path.clone()));
    if parts
        .headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        != Some("Basic Zml4dHVyZS11c2VyOmZpeHR1cmUtcGFzc3dvcmQ=")
    {
        return respond(StatusCode::UNAUTHORIZED, vec![], false);
    }
    if let Some(location) = &state.redirect {
        return Response::builder()
            .status(307)
            .header(header::LOCATION, location)
            .body(Body::empty())
            .unwrap();
    }
    if let Some(code) = state.status {
        return Response::builder()
            .status(code)
            .header(header::RETRY_AFTER, "123")
            .body(Body::empty())
            .unwrap();
    }
    if method == "MKCOL" {
        return respond(StatusCode::CREATED, vec![], false);
    }
    let current = state.files.get(&path).cloned();
    let etag = current
        .as_ref()
        .map(|b| format!("\"{}\"", crypto::digest(b)));
    if matches!(method, "PUT" | "DELETE") && !state.ignore_conditions {
        let if_match = parts
            .headers
            .get(header::IF_MATCH)
            .and_then(|h| h.to_str().ok());
        if if_match.is_some_and(|v| Some(v) != etag.as_deref())
            || (parts.headers.contains_key(header::IF_NONE_MATCH) && current.is_some())
        {
            return respond(StatusCode::PRECONDITION_FAILED, vec![], false);
        }
    }
    match method {
        "GET" => match current {
            Some(bytes) => respond(StatusCode::OK, bytes, state.weak_etags),
            None => respond(StatusCode::NOT_FOUND, vec![], false),
        },
        "PUT" => {
            if (state.fail_object && path.contains("/objects/"))
                || (state.fail_index && path.ends_with("index.zns"))
            {
                return respond(StatusCode::INTERNAL_SERVER_ERROR, vec![], false);
            }
            if state.race_index && path.ends_with("index.zns") {
                state.race_index = false;
                return respond(StatusCode::PRECONDITION_FAILED, vec![], false);
            }
            let status = if current.is_some() {
                StatusCode::NO_CONTENT
            } else {
                StatusCode::CREATED
            };
            state.files.insert(path.clone(), bytes.clone());
            if state.lose_commit_response && path.ends_with("index.zns") {
                state.lose_commit_response = false;
                return respond(StatusCode::INTERNAL_SERVER_ERROR, vec![], false);
            }
            respond(status, bytes, false)
        }
        "DELETE" => {
            state.files.remove(&path);
            respond(StatusCode::NO_CONTENT, vec![], false)
        }
        _ => respond(StatusCode::METHOD_NOT_ALLOWED, vec![], false),
    }
}

fn snapshot(values: &[(&str, &[u8])]) -> Snapshot {
    values
        .iter()
        .map(|(id, bytes)| (id.to_string(), bytes.to_vec()))
        .collect()
}

fn synced(result: Result<SyncOutcome, SyncError>) -> (Manifest, Snapshot) {
    match result.unwrap() {
        SyncOutcome::Synced { manifest, snapshot } => (manifest, snapshot),
        SyncOutcome::Conflicts(_) => panic!("Unexpected conflict"),
    }
}

mod failures;
mod protocol;

#[test]
fn recovery_round_trip_random_nonce_and_authenticated_context() {
    let (key, recovery) = SyncKey::generate();
    let recovered = SyncKey::from_recovery(&recovery).unwrap();
    let sealed = key
        .seal(VAULT, "object", "私有笔记正文".as_bytes())
        .unwrap();
    assert_eq!(
        recovered.open(VAULT, "object", &sealed).unwrap(),
        "私有笔记正文".as_bytes()
    );
    assert_ne!(
        sealed,
        key.seal(VAULT, "object", "私有笔记正文".as_bytes())
            .unwrap()
    );
    assert!(recovered.open("other-vault", "object", &sealed).is_err());
    assert!(recovered.open(VAULT, "index", &sealed).is_err());
    let (wrong, _) = SyncKey::generate();
    assert_eq!(
        wrong.open(VAULT, "object", &sealed).unwrap_err(),
        SyncError::Decryption
    );
    let mut damaged = sealed.clone();
    damaged[30] ^= 1;
    assert!(key.open(VAULT, "object", &damaged).is_err());
    assert!(SyncKey::from_recovery("ZNS1-not-a-recovery-code").is_err());
}

mod resolution;
