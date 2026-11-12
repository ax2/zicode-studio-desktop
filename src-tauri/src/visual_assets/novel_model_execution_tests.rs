use super::*;
use crate::visual_assets::novel_draft_commands::model_commands::jobs::Store;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    thread,
};
use uuid::Uuid;

fn response() -> Value {
    json!({"id":"response-1","choices":[{"finish_reason":"stop","message":{"content":" 守在桥头的人物建议 "}}],"usage":{"prompt_tokens":23,"completion_tokens":9,"total_tokens":32}})
}

#[test]
fn accepts_only_complete_bounded_text_and_valid_usage_without_exporting_other_fields() {
    let good = outcome(&response(), 25);
    assert_eq!(good["state"], "ready");
    assert_eq!(good["text"], "守在桥头的人物建议");
    assert_eq!(good["providerResponseId"], "response-1");
    assert_eq!(good["usage"]["totalTokens"], 32);
    assert!(good["cost"].is_null());
    for patch in [
        json!({"finish_reason":"length","message":{"content":"partial"}}),
        json!({"finish_reason":"stop","message":{"content":"x".repeat(4001)}}),
        json!({"finish_reason":"stop","message":{"content":" "}}),
        json!({"finish_reason":"stop","message":{"content":"ok","tool_calls":[{"name":"delete"}]}}),
        json!({"finish_reason":"stop","message":{"content":"ok","tool_calls":{}}}),
        json!({"finish_reason":"stop","message":{"content":"ok","refusal":"no"}}),
        json!({"message":{"content":"no completion marker"}}),
    ] {
        let result = outcome(&json!({"choices":[patch],"rawSecret":"not-for-storage"}), 1);
        assert_eq!(result["state"], "rejected");
        assert!(result["text"].is_null());
        assert!(!result.to_string().contains("not-for-storage"));
    }
    let mut invalid = response();
    invalid["id"] = json!("response\nsecret");
    invalid["usage"]["total_tokens"] = json!(33);
    let result = outcome(&invalid, 30);
    assert!(result["usage"].is_null());
    assert!(result["providerResponseId"].is_null());
}

struct Fixture {
    root: PathBuf,
    store: Store,
    plan: Value,
}
impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/visual-assets-model-jobs")
            .join(format!("http-{}", Uuid::new_v4()));
        let library = Uuid::new_v4().to_string();
        let workspace = Uuid::new_v4().to_string();
        let store = Store::open(&root, &library, &workspace, "fiction").unwrap();
        let plan = json!({"libraryId":library,"sceneId":"fiction","evidence":{"workspaceId":workspace},"characterId":Uuid::new_v4().to_string(),"digest":"a".repeat(64),"prompt":"Reviewed excerpt"});
        Self { root, store, plan }
    }
    fn endpoint(&self, url: &str) -> ModelEndpoint {
        let digest = Sha256::digest(b"fiction");
        let scene: String = digest[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let path = self.root.join("scenes").join(scene).join("agent");
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join("models.json"),json!({"providers":{"test":{"api":"openai-completions","baseUrl":url,"authHeader":false,"models":[{"id":"model"}]}}}).to_string()).unwrap();
        model_tools::resolve(&self.root, "fiction", Some("test"), Some("model")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let root = self.root.canonicalize().unwrap();
        let expected = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/visual-assets-model-jobs")
            .canonicalize()
            .unwrap();
        assert_eq!(root.parent(), Some(expected.as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("http-"));
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn sends_once_after_durable_boundary_and_keeps_unknown_transport_outcomes() {
    for reply in [Some(response()), None] {
        let f = Fixture::new();
        let id = Uuid::new_v4();
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = f.endpoint(&format!("http://{}/v1", server.local_addr().unwrap()));
        server.set_nonblocking(true).unwrap();
        let store = f.store.clone();
        let worker = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match server.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline);
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            assert_eq!(store.get(id).unwrap().unwrap().state, "unknown");
            let mut bytes = Vec::new();
            let body = loop {
                let mut chunk = [0u8; 2048];
                let count = stream.read(&mut chunk).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&chunk[..count]);
                if let Some(end) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let len: usize = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + len {
                        break serde_json::from_slice::<Value>(&bytes[end + 4..end + 4 + len])
                            .unwrap();
                    }
                }
            };
            if let Some(reply) = reply {
                let body = reply.to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
            body
        });
        f.store.begin(id, &f.plan).unwrap();
        let result = execute(
            endpoint,
            None,
            f.plan["prompt"].as_str().unwrap().into(),
            CancellationToken::new(),
        )
        .await;
        let request = worker.join().unwrap();
        assert_eq!(request["messages"][0]["content"], f.plan["prompt"]);
        assert_eq!(request["max_tokens"], 2048);
        if let Some(result) = result {
            f.store.finish(id, &result).unwrap();
            assert_eq!(f.store.get(id).unwrap().unwrap().state, "ready");
        } else {
            f.store.record_unknown(id).unwrap();
            assert_eq!(f.store.get(id).unwrap().unwrap().state, "unknown");
            assert!(f.store.begin(Uuid::new_v4(), &f.plan).is_err());
        }
        assert!(f.store.begin(id, &f.plan).is_err());
    }
}

#[tokio::test]
async fn cancellation_before_send_keeps_the_durable_record_and_never_contacts_the_server() {
    let f = Fixture::new();
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    server.set_nonblocking(true).unwrap();
    let endpoint = f.endpoint(&format!("http://{}/v1", server.local_addr().unwrap()));
    let id = Uuid::new_v4();
    f.store.begin(id, &f.plan).unwrap();
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    assert!(
        execute(endpoint, None, "Reviewed excerpt".into(), cancellation)
            .await
            .is_none()
    );
    assert_eq!(
        server.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert_eq!(f.store.get(id).unwrap().unwrap().state, "unknown");
}
