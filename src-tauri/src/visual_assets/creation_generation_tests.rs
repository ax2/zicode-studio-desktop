use super::super::creation_types::generation::{capabilities, Generation, Mode, Options, Profile};
use super::*;
use std::{
    io::Cursor,
    thread,
    time::{Duration, Instant},
};

fn plan(f: &Fixture, mode: Mode, format: Option<&str>) -> Plan {
    let mut settings = f.plan.settings.clone();
    settings.capability_profile = Some(Profile::GptImage26);
    let mut input = f.plan.input.clone();
    input.person = if mode == Mode::Text {
        None
    } else {
        input.person
    };
    input.description = "画一张森林小屋，保留参考图中的构图".into();
    input.generation = Some(Generation {
        mode,
        options: Options {
            format: format.map(str::to_owned),
            quality: Some("low".into()),
            complexity: Some("low".into()),
            ..Options::default()
        },
    });
    Plan::prepare(&f.db, "workspace", "scene", settings, input).unwrap()
}

#[test]
fn generation_modes_bind_references_route_parameters_and_legacy_credentials() {
    let f = Fixture::new("https://api.openai.com/v1");
    let legacy = serde_json::to_value(&f.plan).unwrap();
    assert_eq!(legacy["input"].as_object().unwrap().len(), 3);
    assert_eq!(legacy["settings"].as_object().unwrap().len(), 5);
    for mode in [Mode::Text, Mode::Image] {
        let plan = plan(&f, mode, Some("png"));
        plan.validate(&f.db).unwrap();
        assert_eq!(plan.schema_version, 2);
        assert_eq!(plan.prompt, plan.input.description);
        assert_eq!(
            plan.settings.credential_id().unwrap(),
            f.plan.settings.credential_id().unwrap()
        );
        assert_eq!(
            plan.images(&f.db, &f.library).unwrap().len(),
            usize::from(mode == Mode::Image)
        );
        assert_eq!(
            plan.endpoint().unwrap().path(),
            if mode == Mode::Text {
                "/v1/images/generations"
            } else {
                "/v1/images/edits"
            }
        );
        assert_ne!(plan.digest, f.plan.digest);
        let mut edited = plan.clone();
        edited.input.generation.as_mut().unwrap().options.background = Some("transparent".into());
        assert!(edited.validate(&f.db).is_err());
        edited = plan.clone();
        edited.input.person = if mode == Mode::Text {
            f.plan.input.person
        } else {
            None
        };
        assert!(Plan::prepare(&f.db, "workspace", "scene", edited.settings, edited.input).is_err());
    }
    let mut absent = f.plan.input.clone();
    absent.person = None;
    assert!(Plan::prepare(&f.db, "workspace", "scene", f.plan.settings.clone(), absent).is_err());
    f.clean();
}

#[test]
fn unknown_models_do_not_inherit_capabilities_and_invalid_parameters_fail_locally() {
    let f = Fixture::new("https://api.openai.com/v1");
    let mut settings = f.plan.settings.clone();
    assert!(capabilities(&settings).formats.is_empty());
    settings.model = "gpt-image-2.6-flare".into();
    assert!(capabilities(&settings).complexities.contains(&"low"));
    settings.base_url = "https://api.openai.com.example/v1".into();
    assert!(capabilities(&settings).formats.is_empty());
    settings.capability_profile = Some(Profile::GptImage);
    assert!(capabilities(&settings).complexities.is_empty());
    let valid = plan(&f, Mode::Text, Some("png"));
    for (name, value) in [
        ("format", json!("svg")),
        ("size", json!("1x99999")),
        ("quality", json!("unknown")),
        ("background", json!("unknown")),
        ("complexity", json!("maximum")),
        ("compression", json!(101)),
    ] {
        let mut input = serde_json::to_value(&valid.input).unwrap();
        input["generation"]["options"][name] = value;
        let input: Input = serde_json::from_value(input).unwrap();
        assert!(
            Plan::prepare(&f.db, "workspace", "scene", valid.settings.clone(), input).is_err(),
            "{name}"
        );
    }
    let mut invalid = valid.input.clone();
    let options = &mut invalid.generation.as_mut().unwrap().options;
    options.format = Some("jpeg".into());
    options.background = Some("transparent".into());
    assert!(Plan::prepare(&f.db, "workspace", "scene", valid.settings.clone(), invalid).is_err());
    let mut unsupported = valid.settings.clone();
    unsupported.capability_profile = None;
    assert!(Plan::prepare(
        &f.db,
        "workspace",
        "scene",
        unsupported.clone(),
        valid.input.clone()
    )
    .is_err());
    let mut basic = valid.input.clone();
    basic.generation.as_mut().unwrap().options = Options::default();
    let basic = Plan::prepare(&f.db, "workspace", "scene", unsupported, basic).unwrap();
    assert!(basic.parameters().is_empty());
    f.clean();
}

fn encoded_image(format: image::ImageFormat) -> Vec<u8> {
    let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        8,
        8,
        image::Rgb([50, 90, 120]),
    ));
    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, format).unwrap();
    bytes.into_inner()
}

fn seed_decoded_result(f: &Fixture, bytes: &[u8]) {
    // The Rust test harness cannot serve the native image-worker command. Seed
    // decoded fixture bytes like Fixture::new, so these tests cover transport,
    // existing-blob archive and restore. Native worker acceptance remains separate.
    let image = super::super::worker::decode_static(bytes).unwrap();
    let mut thumbnail = Cursor::new(Vec::new());
    image
        .thumbnail(256, 256)
        .write_to(&mut thumbnail, image::ImageFormat::Png)
        .unwrap();
    let digest = hash(bytes);
    std::fs::write(f.library.join(format!("{digest}.blob")), bytes).unwrap();
    std::fs::write(
        f.library.join(format!("{digest}.png")),
        thumbnail.into_inner(),
    )
    .unwrap();
    f.db.execute(
        "INSERT OR IGNORE INTO blob VALUES (?1,?2)",
        params![digest, bytes.len()],
    )
    .unwrap();
}

fn server(status: u16, body: String) -> (String, thread::JoinHandle<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "no request received");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut received = Vec::new();
        loop {
            let mut buffer = [0u8; 4096];
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0 && received.len() < 1024 * 1024);
            received.extend_from_slice(&buffer[..count]);
            if let Some(end) = received.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&received[..end]).to_lowercase();
                let length: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length:"))
                    .unwrap()
                    .trim()
                    .parse()
                    .unwrap();
                if received.len() >= end + 4 + length {
                    break;
                }
            }
        }
        write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        received
    });
    (format!("http://{address}/v1"), worker)
}

#[tokio::test]
async fn generation_and_edit_wire_requests_and_existing_blob_archives_preserve_three_formats() {
    for mode in [Mode::Text, Mode::Image] {
        for (format, image_format) in [
            ("png", image::ImageFormat::Png),
            ("jpeg", image::ImageFormat::Jpeg),
            ("webp", image::ImageFormat::WebP),
        ] {
            let bytes = encoded_image(image_format);
            let body = json!({"data":[{"b64_json":base64::engine::general_purpose::STANDARD.encode(&bytes)}]}).to_string();
            let (base, worker) = server(200, body);
            let mut f = Fixture::new(&base);
            let plan = plan(&f, mode, Some(format));
            let id = Uuid::new_v4();
            f.store.begin(id, &plan).unwrap();
            let result = creation_http::create(
                &plan,
                id,
                plan.images(&f.db, &f.library).unwrap(),
                None,
                CancellationToken::new(),
            )
            .await
            .unwrap();
            let received = worker.join().unwrap();
            assert_client_request_id(&received, id);
            let wire = String::from_utf8_lossy(&received);
            assert!(!wire.to_lowercase().contains("authorization:"));
            if mode == Mode::Text {
                assert!(wire.starts_with("POST /v1/images/generations "));
                let end = received
                    .windows(4)
                    .position(|part| part == b"\r\n\r\n")
                    .unwrap();
                let body: serde_json::Value = serde_json::from_slice(&received[end + 4..]).unwrap();
                assert_eq!(body["n"], 1);
                assert_eq!(body["output_format"], format);
                assert_eq!(body["prompt"], plan.prompt);
                assert!(body.get("image").is_none() && body.get("size").is_none());
            } else {
                assert!(wire.starts_with("POST /v1/images/edits "));
                assert!(wire.contains("name=\"image[]\""));
                assert!(received
                    .windows(f.bytes.len())
                    .any(|value| value == f.bytes));
                assert!(!wire.contains("Person.png"));
                assert!(wire.contains(&format!("name=\"output_format\"\r\n\r\n{format}")));
            }
            assert_eq!(result.bytes, bytes);
            seed_decoded_result(&f, &bytes);
            f.store
                .finish(id, &result.bytes, "fixture thumbnail", &result.usage)
                .unwrap();
            let saved = archive::save(
                &mut f.db,
                &f.library,
                id,
                &plan,
                &bytes,
                &hash(&bytes),
                &result.usage,
            )
            .unwrap();
            let name: String =
                f.db.query_row(
                    "SELECT name FROM asset WHERE id=?1",
                    [saved["assetId"].as_i64().unwrap()],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(name.ends_with(&format!(".{format}")));
            assert_eq!(
                std::fs::read(f.library.join(format!("{}.blob", hash(&bytes)))).unwrap(),
                bytes
            );
            let reopened = Store::open(&f.root.join("jobs"), "workspace", "scene").unwrap();
            assert_eq!(
                reopened.get(&plan.library_id, id).unwrap().unwrap()["plan"],
                serde_json::to_value(&plan).unwrap()
            );
            f.clean();
        }
    }
}

#[tokio::test]
async fn quota_and_wrong_format_remain_rejected_or_unknown_without_an_output_to_approve() {
    for quota in [true, false] {
        let body = if quota {
            json!({"error":{"code":"insufficient_quota"}})
        } else {
            json!({"data":[{"b64_json":base64::engine::general_purpose::STANDARD.encode(encoded_image(image::ImageFormat::Jpeg))}]})
        };
        let (base, worker) = server(if quota { 429 } else { 200 }, body.to_string());
        let f = Fixture::new(&base);
        let plan = plan(&f, Mode::Text, Some("png"));
        let id = Uuid::new_v4();
        f.store.begin(id, &plan).unwrap();
        let error = creation_http::create(&plan, id, vec![], None, CancellationToken::new())
            .await
            .err()
            .unwrap()
            .to_string();
        assert_client_request_id(&worker.join().unwrap(), id);
        if quota {
            assert_eq!(error, "visual_assets_creation_quota_exhausted");
            f.store.reject(id, &error).unwrap();
        } else {
            assert_eq!(error, "visual_assets_creation_result_invalid");
        }
        assert!(f.store.output(&plan.library_id, id).is_err());
        assert_eq!(
            f.store.get(&plan.library_id, id).unwrap().unwrap()["state"],
            if quota { "rejected" } else { "unknown" }
        );
        f.clean();
    }
}

#[test]
fn generation_sources_and_original_bytes_survive_offline_backup_restore() {
    let mut f = Fixture::new("https://api.openai.com/v1");
    let mut expected = Vec::new();
    for mode in [Mode::Text, Mode::Image] {
        let plan = plan(&f, mode, Some("webp"));
        let bytes = encoded_image(image::ImageFormat::WebP);
        seed_decoded_result(&f, &bytes);
        let id = Uuid::new_v4();
        let saved = archive::save(
            &mut f.db,
            &f.library,
            id,
            &plan,
            &bytes,
            &hash(&bytes),
            &json!({"cost":null}),
        )
        .unwrap();
        expected.push((id, saved, bytes));
    }
    let destination = f.root.join("generation-backup");
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
    let restored = f.root.join("generation-restored");
    snapshot::restore(
        &backup,
        &restored,
        |input, output| {
            std::fs::copy(input, output)?;
            Ok(())
        },
        &|_| Ok(()),
    )
    .unwrap();
    let restored_db = catalog::open(&restored).unwrap();
    for (id, saved, bytes) in expected {
        assert_eq!(archive::get(&restored_db, id).unwrap().unwrap(), saved);
        assert_eq!(
            std::fs::read(restored.join(format!("{}.blob", hash(&bytes)))).unwrap(),
            bytes
        );
    }
    assert_eq!(
        std::fs::read(restored.join(format!("{}.blob", hash(&f.bytes)))).unwrap(),
        f.bytes
    );
    drop(restored_db);
    f.clean();
}
