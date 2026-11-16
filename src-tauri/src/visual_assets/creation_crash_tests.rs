use super::{archive, catalog, hash, Fixture, Plan, Store};
use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use uuid::Uuid;

#[test]
fn creation_crash_child() {
    let Some(root) = std::env::var_os("ZICODE_IMAGE_CREATION_CRASH_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let saved: Value =
        serde_json::from_slice(&std::fs::read(root.join("crash.json")).unwrap()).unwrap();
    let plan: Plan = serde_json::from_value(saved["plan"].clone()).unwrap();
    let id = Uuid::parse_str(saved["id"].as_str().unwrap()).unwrap();
    let phase = saved["phase"].as_str().unwrap();
    let store = Store::open(&root.join("jobs"), "workspace", "scene").unwrap();
    let lease = store.lease(&plan.library_id).unwrap();
    if phase == "lease" {
        std::process::exit(if lease.is_none() { 88 } else { 89 });
    }
    let _lease = lease.unwrap();
    let checkpoint = |name: &str| {
        if name == phase {
            std::process::exit(86);
        }
        Ok(())
    };
    let bytes = include_bytes!("../../icons/32x32.png");
    let thumbnail = base64::engine::general_purpose::STANDARD.encode(bytes);
    if phase.contains("archive") {
        let library = root.join("library");
        let mut db = catalog::open(&library).unwrap();
        archive::save_checked(
            &mut db,
            &library,
            archive::Approval {
                id,
                plan: &plan,
                bytes,
                digest: &hash(bytes),
                usage: &json!({"cost":null}),
            },
            &checkpoint,
        )
        .unwrap();
    } else {
        store.begin_checked(id, &plan, &checkpoint).unwrap();
        store
            .finish_checked(id, bytes, &thumbnail, &json!({"cost":null}), &checkpoint)
            .unwrap();
    }
    panic!("checkpoint was not reached");
}
fn child(f: &Fixture, id: Uuid, phase: &str) -> i32 {
    std::fs::write(
        f.root.join("crash.json"),
        json!({"id":id,"phase":phase,"plan":f.plan}).to_string(),
    )
    .unwrap();
    let output = crate::process_command::new_command(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "visual_assets::creation_tests::crash::creation_crash_child",
            "--nocapture",
        ])
        .env("ZICODE_IMAGE_CREATION_CRASH_ROOT", &f.root)
        .output()
        .unwrap();
    assert!(
        output.status.code().is_some(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.status.code().unwrap()
}
#[test]
fn real_process_exit_preserves_send_and_result_boundaries_and_releases_lease() {
    for phase in [
        "before-begin-commit",
        "after-begin-commit",
        "before-result-commit",
        "after-result-commit",
    ] {
        let f = Fixture::new("https://example.com/v1");
        let id = Uuid::new_v4();
        assert_eq!(child(&f, id, phase), 86, "{phase}");
        let job = f.store.get(&f.plan.library_id, id).unwrap();
        match phase {
            "before-begin-commit" => assert!(job.is_none()),
            "after-result-commit" => {
                assert_eq!(job.unwrap()["state"], "ready");
                assert_eq!(f.store.output(&f.plan.library_id, id).unwrap().0, f.bytes);
            }
            _ => {
                assert_eq!(job.unwrap()["state"], "unknown");
                assert!(f.store.begin(Uuid::new_v4(), &f.plan).is_err());
            }
        }
        assert!(f.store.lease(&f.plan.library_id).unwrap().is_some());
        f.clean();
    }
    let f = Fixture::new("https://example.com/v1");
    let lease = f.store.lease(&f.plan.library_id).unwrap().unwrap();
    assert_eq!(child(&f, Uuid::new_v4(), "lease"), 88);
    drop(lease);
    f.clean();
}
#[test]
fn real_process_exit_keeps_approved_asset_and_source_atomic() {
    for phase in ["before-archive-commit", "after-archive-commit"] {
        let mut f = Fixture::new("https://example.com/v1");
        let id = Uuid::new_v4();
        assert_eq!(child(&f, id, phase), 86, "{phase}");
        let expected = phase == "after-archive-commit";
        assert_eq!(archive::get(&f.db, id).unwrap().is_some(), expected);
        let count: i64 =
            f.db.query_row("SELECT count(*) FROM asset", [], |row| row.get(0))
                .unwrap();
        assert_eq!(count, if expected { 2 } else { 1 });
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
        assert_eq!(
            f.db.query_row("SELECT count(*) FROM asset", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            2
        );
        f.clean();
    }
}
