use super::*;
use std::io::Write;
use std::net::TcpListener;
use std::thread;
use std::time::Instant;

fn mock_server(responses: Vec<(u16, String, String)>) -> (String, thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        let mut requests = Vec::new();
        for (status, body, headers) in responses {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "fixture request timed out");
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(e) => panic!("fixture accept: {e}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0_u8; 2048];
                let count = stream.read(&mut chunk).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&chunk[..count]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            let reply = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len());
            let _ = stream.write_all(reply.as_bytes());
        }
        requests
    });
    (url, worker)
}

fn local_endpoint(base: &str, auth: bool) -> ModelEndpoint {
    endpoint(
        "my-local",
        &json!({"baseUrl":base,"api":"openai-completions","authHeader":auth}),
        &json!({"id":"local-model"}),
    )
    .unwrap()
}

#[test]
fn translates_and_summarizes_through_an_explicit_local_service_without_credentials() {
    let payload = json!({"choices":[{"message":{"content":"本地结果"}}]}).to_string();
    let (url, worker) = mock_server(vec![
        (200, payload.clone(), String::new()),
        (200, payload, String::new()),
    ]);
    let endpoint = local_endpoint(&url, false);
    let translation = crate::translation::translate(
        &crate::translation::TranslationRequest {
            text: "hello".into(),
            target_lang: "Chinese".into(),
            source_lang: None,
        },
        &endpoint,
        None,
    )
    .unwrap();
    let summary = crate::summary::summarize(
        &crate::summary::SummarizeRequest {
            text: "article".into(),
        },
        &endpoint,
        None,
        None,
    )
    .unwrap();
    assert_eq!(translation.translated, "本地结果");
    assert_eq!(summary.summary, "本地结果");
    assert_eq!(summary.model, "local-model");
    let requests = worker.join().unwrap();
    for request in requests {
        assert!(request.starts_with("POST /v1/chat/completions"));
        assert!(!request.to_lowercase().contains("authorization:"));
        assert!(request.contains("local-model"));
    }
}

#[tokio::test]
async fn bounded_plugin_model_request_sets_output_token_budget() {
    let payload = json!({"choices":[{"message":{"content":"ok"}}]}).to_string();
    let (url, worker) = mock_server(vec![(200, payload, String::new())]);
    let result = complete_limited_cancellable(
        &local_endpoint(&url, false),
        None,
        "bounded prompt".into(),
        Duration::from_secs(3),
        128,
        tokio_util::sync::CancellationToken::new(),
    )
    .await
    .unwrap();
    assert_eq!(
        crate::translation::extract_text(&result).as_deref(),
        Some("ok")
    );
    let request = &worker.join().unwrap()[0];
    assert!(request.contains("\"max_tokens\":128"));
    assert!(request.contains("bounded prompt"));
}

#[tokio::test]
async fn cancellable_plugin_model_request_closes_an_in_flight_http_connection() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let (received_tx, received_rx) = std::sync::mpsc::channel();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "fixture request timed out");
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("fixture accept: {error}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut chunk = [0_u8; 2048];
            let count = stream.read(&mut chunk).unwrap();
            assert!(count > 0);
            bytes.extend_from_slice(&chunk[..count]);
            if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = header
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        received_tx.send(()).unwrap();
        let mut extra = [0_u8; 1];
        stream
            .read(&mut extra)
            .map(|count| count == 0)
            .unwrap_or(false)
    });
    let endpoint = local_endpoint(&url, false);
    let cancellation = tokio_util::sync::CancellationToken::new();
    let request_cancellation = cancellation.clone();
    let request = tokio::spawn(async move {
        complete_limited_cancellable(
            &endpoint,
            None,
            "cancel me".into(),
            Duration::from_secs(5),
            128,
            request_cancellation,
        )
        .await
    });
    tokio::task::spawn_blocking(move || {
        received_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("model request did not reach local service");
    })
    .await
    .unwrap();
    cancellation.cancel();
    assert_eq!(
        request.await.unwrap().unwrap_err(),
        "model_request_cancelled"
    );
    assert!(worker.join().unwrap(), "cancelled HTTP socket stayed open");
}

#[test]
fn requires_explicit_scene_model_and_never_exposes_config_credentials() {
    let root = std::env::temp_dir().join(format!("zicode-model-tools-{}", uuid::Uuid::new_v4()));
    let digest = Sha256::digest(b"programming");
    let scene: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    let directory = root.join("scenes").join(scene).join("agent");
    std::fs::create_dir_all(&directory).unwrap();
    let doc = json!({"providers":{
        "local":{"baseUrl":"http://127.0.0.1:11434/v1","api":"openai-completions","authHeader":false,"apiKey":"fixture-not-a-secret","models":[{"id":"one"}]},
        "other":{"baseUrl":"https://example.invalid/v1","api":"anthropic-messages","models":[{"id":"two"}]}
    }});
    std::fs::write(directory.join("models.json"), doc.to_string()).unwrap();
    let choices = catalog(&root, "programming").unwrap();
    assert_eq!(choices.len(), 1);
    assert!(!serde_json::to_string(&choices)
        .unwrap()
        .contains("fixture-not-a-secret"));
    assert!(resolve(&root, "programming", None, None).is_err());
    assert!(resolve(&root, "finance", Some("local"), Some("one")).is_err());
    assert!(resolve(&root, "programming", Some("qveris"), Some("one")).is_err());
    assert!(resolve(&root, "programming", Some("local"), Some("one")).is_ok());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_unsafe_urls_and_unsupported_protocol_contracts() {
    for base in [
        "file:///tmp/model",
        "https://user:pass@example.invalid/v1",
        "https://example.invalid/v1?key=value",
        "https://example.invalid/v1#token",
    ] {
        assert!(endpoint(
            "p",
            &json!({"baseUrl":base,"api":"openai-completions"}),
            &json!({"id":"m"})
        )
        .is_none());
    }
    assert!(endpoint("p", &json!({"baseUrl":"https://example.invalid","api":"openai-completions","headers":{"X-Key":"value"}}), &json!({"id":"m"})).is_none());
    assert!(complete(
        &local_endpoint("http://127.0.0.1:1/v1", true),
        None,
        "test".into(),
        Duration::from_secs(1)
    )
    .unwrap_err()
    .contains("credential_unavailable"));
}

#[test]
fn uses_only_the_supplied_key_and_does_not_follow_redirects_or_echo_server_errors() {
    let (url, worker) = mock_server(vec![(
        302,
        "sensitive server text".into(),
        "Location: http://127.0.0.1:1/other\r\n".into(),
    )]);
    let error = complete(
        &local_endpoint(&url, true),
        Some("fixture-key"),
        "test".into(),
        Duration::from_secs(3),
    )
    .unwrap_err();
    assert_eq!(error, "model_request_failed:302");
    let request = &worker.join().unwrap()[0];
    assert!(request
        .to_lowercase()
        .contains("authorization: bearer fixture-key"));
}

#[test]
fn bounds_and_validates_the_response() {
    let (url, worker) = mock_server(vec![(
        200,
        "x".repeat(MAX_BYTES as usize + 1),
        String::new(),
    )]);
    assert_eq!(
        complete(
            &local_endpoint(&url, false),
            None,
            "test".into(),
            Duration::from_secs(3)
        )
        .unwrap_err(),
        "model_response_too_large"
    );
    worker.join().unwrap();
    let (url, worker) = mock_server(vec![(200, "not json".into(), String::new())]);
    assert_eq!(
        complete(
            &local_endpoint(&url, false),
            None,
            "test".into(),
            Duration::from_secs(3)
        )
        .unwrap_err(),
        "model_response_invalid"
    );
    worker.join().unwrap();
}
