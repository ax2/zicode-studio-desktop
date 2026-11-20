use super::*;

#[test]
fn image_model_profiles_preserve_legacy_config_jobs_and_scope() {
    let f = Fixture::new("https://images.example.com/v1");
    let before = f.store.settings().unwrap();
    let job = Uuid::new_v4();
    f.store.begin(job, &f.plan).unwrap();
    assert!(f.store.model_profiles().unwrap().is_empty());
    assert_eq!(f.store.settings().unwrap().model, before.model);
    let mut second = before.clone();
    second.model = "other-image-model".into();
    second.base_url = "http://127.0.0.1:14888/v1".into();
    let id = f.store.save_model_profile("本机模型", &second).unwrap();
    let profiles = f.store.model_profiles().unwrap();
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0].settings.model, before.model);
    assert_eq!(profiles[0].settings.base_url, before.base_url);
    assert_eq!(f.store.selected_model_profile().unwrap(), Some(id));
    let reopened = Store::open(&f.root.join("jobs"), "workspace", "scene").unwrap();
    assert_eq!(reopened.settings().unwrap().model, second.model);
    reopened.select_model_profile(profiles[0].id).unwrap();
    assert_eq!(reopened.settings().unwrap().model, before.model);
    assert_eq!(
        reopened.get(&f.plan.library_id, job).unwrap().unwrap()["plan"],
        serde_json::to_value(&f.plan).unwrap()
    );
    let other = Store::open(&f.root.join("jobs"), "other-workspace", "scene").unwrap();
    assert!(other.model_profiles().unwrap().is_empty());
    assert!(other.select_model_profile(id).is_err());
    reopened.remove_model_profile(profiles[0].id).unwrap();
    assert!(reopened.selected_model_profile().unwrap().is_none());
    assert_eq!(reopened.settings().unwrap().model, before.model);
    assert!(reopened.get(&f.plan.library_id, job).unwrap().is_some());
    reopened.select_model_profile(id).unwrap();
    reopened.save_settings(&before).unwrap();
    assert!(reopened.selected_model_profile().unwrap().is_none());
    assert_eq!(reopened.model_profiles().unwrap().len(), 1);
    f.clean();
}

#[test]
fn image_model_profiles_reject_bad_names_and_the_33rd_entry_without_changing_active() {
    let f = Fixture::new("https://images.example.com/v1");
    let settings = f.store.settings().unwrap();
    for name in ["", " trimmed", "line\nbreak", &"x".repeat(81)] {
        assert!(f.store.save_model_profile(name, &settings).is_err());
    }
    for index in 0..32 {
        f.store
            .save_model_profile(&format!("Model {index}"), &settings)
            .unwrap();
    }
    let selected = f.store.selected_model_profile().unwrap();
    assert_eq!(f.store.model_profiles().unwrap().len(), 32);
    assert!(f.store.save_model_profile("Too many", &settings).is_err());
    assert_eq!(f.store.selected_model_profile().unwrap(), selected);
    f.clean();
}

#[tokio::test]
async fn image_model_profile_selection_routes_the_reviewed_request_to_its_saved_endpoint() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let f = Fixture::new("https://images.example.com/v1");
    let mut selected = f.store.settings().unwrap();
    selected.model = "selected-image-b".into();
    selected.base_url = format!("http://{address}/selected/v1");
    selected.requires_key = true;
    let profile = f.store.save_model_profile("Selected B", &selected).unwrap();
    f.store.select_model_profile(profile).unwrap();
    // Saving or selecting a model is metadata only, never a generation request.
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    listener.set_nonblocking(false).unwrap();
    let result_bytes = f.bytes.clone();
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut received = Vec::new();
        loop {
            let mut chunk = [0; 8192];
            let count = stream.read(&mut chunk).unwrap();
            assert!(count > 0);
            received.extend_from_slice(&chunk[..count]);
            if let Some(end) = received.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&received[..end]);
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.split_once(':')
                            .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                            .map(|(_, value)| value.trim().parse().unwrap())
                    })
                    .unwrap();
                if received.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let text = String::from_utf8_lossy(&received);
        assert!(text.starts_with("POST /selected/v1/images/edits "));
        assert!(
            text.to_ascii_lowercase()
                .contains("authorization: bearer fixture-image-b")
        );
        assert!(text.contains("selected-image-b"));
        let response=json!({"data":[{"b64_json":base64::engine::general_purpose::STANDARD.encode(&result_bytes)}]}).to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
    });
    let plan = Plan::prepare(
        &f.db,
        "workspace",
        "scene",
        f.store.settings().unwrap(),
        f.plan.input.clone(),
    )
    .unwrap();
    assert_ne!(plan.digest, f.plan.digest);
    let images = plan.images(&f.db, &f.library).unwrap();
    let output = creation_http::create(
        &plan,
        Uuid::new_v4(),
        images,
        Some("fixture-image-b".into()),
        CancellationToken::new(),
    )
    .await
    .unwrap();
    worker.join().unwrap();
    assert_eq!(output.bytes, f.bytes);
    assert!(
        f.store
            .model_profiles()
            .unwrap()
            .iter()
            .any(|row| row.settings.base_url == "https://images.example.com/v1")
    );
    f.clean();
}
