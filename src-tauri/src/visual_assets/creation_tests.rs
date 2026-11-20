use super::{
    catalog, creation_archive as archive, creation_http,
    creation_store::Store,
    creation_types::{hash, Input, Plan, Settings},
    snapshot,
};
use base64::Engine;
use rusqlite::{params, Connection};
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[path = "creation_crash_tests.rs"]
mod crash;

#[path = "creation_generation_tests.rs"]
mod generation;
#[path = "creation_style_tests.rs"]
mod style;

struct Fixture {
    root: PathBuf,
    library: PathBuf,
    db: Connection,
    store: Store,
    plan: Plan,
    bytes: Vec<u8>,
}

#[test]
fn quota_rejection_survives_restart_and_only_a_new_confirmed_job_can_begin() {
    let f = Fixture::new("https://images.example.com/v1");
    let id = Uuid::new_v4();
    f.store.begin(id, &f.plan).unwrap();
    assert!(f.store.reject(id, "untrusted provider text").is_err());
    f.store
        .reject(id, "visual_assets_creation_quota_exhausted")
        .unwrap();
    let reopened = Store::open(&f.root.join("jobs"), "workspace", "scene").unwrap();
    let job = reopened.get(&f.plan.library_id, id).unwrap().unwrap();
    assert_eq!(job["state"], "rejected");
    assert_eq!(job["error"], "visual_assets_creation_quota_exhausted");
    assert!(reopened.begin(id, &f.plan).is_err());
    assert!(reopened.output(&f.plan.library_id, id).is_err());
    assert_eq!(
        reopened.history(&f.plan.library_id, None).unwrap()["entries"][0]["error"],
        job["error"]
    );
    f.clean();
}
impl Fixture {
    fn new(base: &str) -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/visual-assets-outfit")
            .join(format!("fixture-{}", Uuid::new_v4()));
        let library = root.join("library");
        std::fs::create_dir_all(&library).unwrap();
        let db = catalog::open(&library).unwrap();
        db.execute_batch("PRAGMA user_version=1").unwrap();
        let bytes = include_bytes!("../../icons/32x32.png").to_vec();
        let digest = hash(&bytes);
        std::fs::write(library.join(format!("{digest}.blob")), &bytes).unwrap();
        std::fs::write(library.join(format!("{digest}.png")), &bytes).unwrap();
        db.execute(
            "INSERT INTO blob VALUES (?1,?2)",
            params![digest, bytes.len()],
        )
        .unwrap();
        let asset = catalog::add_asset(&db, "Person.png").unwrap();
        db.execute(
            "INSERT INTO revision VALUES (?1,1,?2)",
            params![asset, digest],
        )
        .unwrap();
        let settings = Settings {
            base_url: base.into(),
            model: "fixture-image".into(),
            requires_key: false,
            size: "auto".into(),
            quality: "auto".into(),
            capability_profile: None,
        };
        let store = Store::open(&root.join("jobs"), "workspace", "scene").unwrap();
        store.save_settings(&settings).unwrap();
        let plan = Plan::prepare(
            &db,
            "workspace",
            "scene",
            settings,
            Input {
                person: Some(asset),
                clothing: None,
                description: "换成蓝色外套".into(),
                style: None,
                generation: None,
            },
        )
        .unwrap();
        Self {
            root,
            library,
            db,
            store,
            plan,
            bytes,
        }
    }
    fn clean(self) {
        let root = self.root.canonicalize().unwrap();
        let expected = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/visual-assets-outfit")
            .canonicalize()
            .unwrap();
        assert_eq!(root.parent(), Some(expected.as_path()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("fixture-"));
        drop(self);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn config_and_plan_bind_the_destination_images_and_prompt_without_credentials() {
    let scope = super::creation_types::credential_scope;
    assert_ne!(scope("workspace", "scene"), "scene");
    assert_eq!(scope("workspace", "scene"), scope("workspace", "scene"));
    assert_ne!(scope("a", "bc"), scope("ab", "c"));
    assert_ne!(scope("workspace", "scene"), scope("other", "scene"));
    let f = Fixture::new("https://example.com/v1");
    f.plan.validate(&f.db).unwrap();
    assert_eq!(
        f.plan.images(&f.db, &f.library).unwrap(),
        vec![f.bytes.clone()]
    );
    let original = f.plan.settings.credential_id().unwrap();
    for url in [
        "http://example.com/v1",
        "https://secret@example.com/v1",
        "https://example.com/v1?key=hidden",
        "file:///tmp/api",
    ] {
        let mut settings = f.plan.settings.clone();
        settings.base_url = url.into();
        assert!(settings.endpoint().is_err(), "{url}");
    }
    let mut changed = f.plan.clone();
    changed.settings.base_url = "https://example.com/other".into();
    assert_ne!(changed.settings.credential_id().unwrap(), original);
    assert!(changed.validate(&f.db).is_err());
    let mut value = serde_json::to_value(&f.plan).unwrap();
    value["settings"]["apiKey"] = json!("not permitted");
    assert!(serde_json::from_value::<Plan>(value).is_err());
    std::fs::write(
        f.library
            .join(format!("{}.blob", f.plan.references[0].sha256)),
        b"changed",
    )
    .unwrap();
    assert!(f.plan.images(&f.db, &f.library).is_err());
    f.clean();
}

#[test]
fn unknown_jobs_survive_reopen_prevent_replay_and_are_scoped() {
    let f = Fixture::new("http://127.0.0.1:1/v1");
    let id = Uuid::new_v4();
    let lease = f.store.lease(&f.plan.library_id).unwrap().unwrap();
    assert!(f.store.lease(&f.plan.library_id).unwrap().is_none());
    drop(lease);
    f.store.begin(id, &f.plan).unwrap();
    let reopened = Store::open(&f.root.join("jobs"), "workspace", "scene").unwrap();
    assert_eq!(
        reopened.get(&f.plan.library_id, id).unwrap().unwrap()["state"],
        "unknown"
    );
    assert!(reopened.begin(id, &f.plan).is_err());
    assert!(reopened.begin(Uuid::new_v4(), &f.plan).is_err());
    assert!(Store::open(&f.root.join("jobs"), "other", "scene")
        .unwrap()
        .get(&f.plan.library_id, id)
        .unwrap()
        .is_none());
    assert!(Store::open(&f.root.join("jobs"), "workspace", "other")
        .unwrap()
        .get(&f.plan.library_id, id)
        .unwrap()
        .is_none());
    reopened
        .reject(id, "visual_assets_creation_provider_rejected")
        .unwrap();
    reopened.begin(Uuid::new_v4(), &f.plan).unwrap();
    assert_eq!(
        reopened.history(&f.plan.library_id, None).unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    f.clean();
}

#[test]
fn history_pages_are_stable_and_output_and_source_tampering_are_rejected() {
    let mut f = Fixture::new("https://example.com/v1");
    let mut ids = Vec::new();
    for _ in 0..23 {
        let id = Uuid::new_v4();
        f.store.begin(id, &f.plan).unwrap();
        f.store
            .reject(id, "visual_assets_creation_provider_rejected")
            .unwrap();
        ids.push(id.to_string());
    }
    let mut before = None;
    let mut listed = Vec::new();
    loop {
        let page = f.store.history(&f.plan.library_id, before).unwrap();
        let rows = page["entries"].as_array().unwrap();
        assert!(rows.len() <= 10);
        listed.extend(
            rows.iter()
                .map(|entry| entry["id"].as_str().unwrap().to_owned()),
        );
        before = page["next"].as_i64();
        if before.is_none() {
            break;
        }
    }
    ids.reverse();
    assert_eq!(listed, ids);
    let id = Uuid::new_v4();
    f.store.begin(id, &f.plan).unwrap();
    assert!(f
        .store
        .finish(id, &f.bytes, "thumbnail", &json!({"secret":"not allowed"}))
        .is_err());
    f.store
        .finish(id, &f.bytes, "thumbnail", &json!({"cost":null}))
        .unwrap();
    let connection = Connection::open(f.root.join("jobs/image-creation.sqlite")).unwrap();
    connection
        .execute(
            "UPDATE image_job SET output=?1 WHERE id=?2",
            params![b"changed", id.to_string()],
        )
        .unwrap();
    assert!(f.store.output(&f.plan.library_id, id).is_err());
    drop(connection);
    archive::save(
        &mut f.db,
        &f.library,
        id,
        &f.plan,
        &f.bytes,
        &hash(&f.bytes),
        &json!({"cost":null}),
    )
    .unwrap();
    f.db.execute(
        "UPDATE image_creation_source SET usage=?1",
        [r#"{"secret":"not allowed"}"#],
    )
    .unwrap();
    assert!(archive::validate_snapshot(&f.db).is_err());
    f.clean();
}

fn assert_client_request_id(received: &[u8], id: Uuid) {
    let end = received
        .windows(4)
        .position(|value| value == b"\r\n\r\n")
        .expect("request headers end before the body");
    let headers = String::from_utf8_lossy(&received[..end]);
    let sent_ids: Vec<_> = headers
        .lines()
        .filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("x-client-request-id"))
        .map(|(_, value)| value.trim())
        .collect();
    assert_eq!(sent_ids, [id.to_string().as_str()]);
}

#[tokio::test]
async fn multipart_edit_is_sent_only_after_durable_job_and_archive_restores_offline() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut f = Fixture::new(&format!("http://{}/v1", listener.local_addr().unwrap()));
    let response = json!({
        "data": [{"b64_json": base64::engine::general_purpose::STANDARD.encode(&f.bytes)}],
        "usage": {
            "input_tokens": 10, "output_tokens": 20, "total_tokens": 30,
            "input_tokens_details": {"text_tokens": 3, "image_tokens": 7, "secret": "not archived"},
            "output_tokens_details": {"text_tokens": 0, "image_tokens": 20},
            "cost": 42, "secret": "not archived"
        },
        "server_secret": "not archived"
    })
    .to_string();
    let path = f.root.join("jobs/image-creation.sqlite");
    let id = Uuid::new_v4();
    let worker = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut received = Vec::new();
        let mut buffer = [0; 8192];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0);
            received.extend_from_slice(&buffer[..count]);
            if let Some(end) = received.windows(4).position(|value| value == b"\r\n\r\n") {
                let header = String::from_utf8_lossy(&received[..end]);
                let length: usize = header
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse().unwrap())
                    })
                    .unwrap();
                if received.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let db = Connection::open(path).unwrap();
        assert_eq!(
            db.query_row(
                "SELECT state FROM image_job WHERE id=?1",
                [id.to_string()],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "unknown"
        );
        assert_client_request_id(&received, id);
        let text = String::from_utf8_lossy(&received);
        assert!(text.starts_with("POST /v1/images/edits "));
        assert!(text.contains("name=\"image[]\""));
        assert!(text.contains("fixture-image"));
        assert!(text.contains("换成蓝色外套"));
        assert!(!text.contains("Person.png"));
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
    });
    let images = f.plan.images(&f.db, &f.library).unwrap();
    f.store.begin(id, &f.plan).unwrap();
    let result = creation_http::create(&f.plan, id, images, None, CancellationToken::new())
        .await
        .unwrap();
    worker.join().unwrap();
    assert_eq!(result.bytes, f.bytes);
    assert_eq!(
        result.usage,
        json!({
            "inputTokens": 10, "outputTokens": 20, "totalTokens": 30,
            "textInputTokens": 3, "imageInputTokens": 7,
            "textOutputTokens": 0, "imageOutputTokens": 20, "cost": null
        })
    );
    // The fixture is an existing, validated repository PNG; this is not model quality evidence.
    let thumb = base64::engine::general_purpose::STANDARD.encode(&result.bytes);
    f.store
        .finish(id, &result.bytes, &thumb, &result.usage)
        .unwrap();
    let reopened = Store::open(&f.root.join("jobs"), "workspace", "scene").unwrap();
    assert_eq!(
        reopened.get(&f.plan.library_id, id).unwrap().unwrap()["usage"],
        result.usage
    );
    assert!(archive::get(&f.db, id).unwrap().is_none());
    let digest = hash(&result.bytes);
    assert!(archive::save(
        &mut f.db,
        &f.library,
        id,
        &f.plan,
        &result.bytes,
        "wrong",
        &result.usage
    )
    .is_err());
    let saved = archive::save(
        &mut f.db,
        &f.library,
        id,
        &f.plan,
        &result.bytes,
        &digest,
        &result.usage,
    )
    .unwrap();
    let again = archive::save(
        &mut f.db,
        &f.library,
        id,
        &f.plan,
        &result.bytes,
        &digest,
        &result.usage,
    )
    .unwrap();
    assert_eq!(saved, again);
    assert_eq!(
        f.db.query_row("SELECT count(*) FROM asset", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        2
    );
    let destination = f.root.join("backup");
    std::fs::create_dir(&destination).unwrap();
    let backup = snapshot::create(
        &mut f.db,
        &f.library,
        &destination,
        None,
        &|_| Ok(()),
        &|_| Ok(()),
    )
    .unwrap();
    let restored = f.root.join("restored");
    let manifest = snapshot::restore(
        &backup,
        &restored,
        |input, output| {
            std::fs::copy(input, output)?;
            Ok(())
        },
        &|_| Ok(()),
    )
    .unwrap();
    assert_eq!(serde_json::to_value(manifest).unwrap()["version"], 10);
    let restored_db = catalog::open(&restored).unwrap();
    assert_eq!(archive::get(&restored_db, id).unwrap().unwrap(), saved);
    let mut page = catalog::page(&restored_db, 0).unwrap();
    archive::fill_page(&restored_db, &mut page).unwrap();
    assert!(page
        .assets
        .iter()
        .any(|asset| asset.creation_job_id.as_deref() == Some(id.to_string().as_str())));
    drop(restored_db);
    f.clean();
}

#[tokio::test]
async fn cancellation_does_not_send_and_connection_loss_remains_unknown() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let f = Fixture::new(&format!("http://{}/v1", listener.local_addr().unwrap()));
    let id = Uuid::new_v4();
    f.store.begin(id, &f.plan).unwrap();
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(
        creation_http::create(&f.plan, id, vec![f.bytes.clone()], None, cancel)
            .await
            .is_err()
    );
    assert!(listener.accept().is_err());
    drop(listener);
    assert!(creation_http::create(
        &f.plan,
        id,
        vec![f.bytes.clone()],
        None,
        CancellationToken::new()
    )
    .await
    .is_err());
    assert_eq!(
        f.store.get(&f.plan.library_id, id).unwrap().unwrap()["state"],
        "unknown"
    );
    f.clean();
}

#[path = "creation_model_profile_tests.rs"]
mod model_profiles;
