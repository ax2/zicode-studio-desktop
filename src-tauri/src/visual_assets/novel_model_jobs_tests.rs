use super::*;
use std::os::windows::process::CommandExt;

struct Fixture {
    root: PathBuf,
    store: Store,
    plan: Value,
}
impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/visual-assets-model-jobs")
            .join(format!("fixture-{}", Uuid::new_v4()));
        let library = Uuid::new_v4().to_string();
        let workspace = Uuid::new_v4().to_string();
        let store = Store::open(&root, &library, &workspace, "fiction").unwrap();
        let plan = json!({"libraryId":library,"sceneId":"fiction","evidence":{"workspaceId":workspace},
            "characterId":Uuid::new_v4().to_string(),"digest":"a".repeat(64),"prompt":"Reviewed excerpt"});
        Self { root, store, plan }
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
            .starts_with("fixture-"));
        std::fs::remove_dir_all(root).unwrap();
    }
}

fn ready() -> Value {
    json!({"state":"ready","text":"模型建议，待人工审核","usage":null,"cost":null})
}

#[test]
fn persists_unknown_before_dispatch_and_never_overwrites_or_replays_a_job() {
    let f = Fixture::new();
    let id = Uuid::new_v4();
    f.store.begin(id, &f.plan).unwrap();
    let reopened = Store::open(
        &f.root,
        &f.store.library,
        &f.store.workspace,
        &f.store.scene,
    )
    .unwrap();
    assert_eq!(reopened.get(id).unwrap().unwrap().state, "unknown");
    assert!(reopened
        .begin(id, &f.plan)
        .unwrap_err()
        .to_string()
        .contains("job_exists"));
    assert!(reopened
        .begin(Uuid::new_v4(), &f.plan)
        .unwrap_err()
        .to_string()
        .contains("outcome_unknown"));
    reopened.record_unknown(id).unwrap();
    assert_eq!(
        reopened.get(id).unwrap().unwrap().error.as_deref(),
        Some("visual_assets_model_outcome_unknown")
    );
    reopened.finish(id, &ready()).unwrap();
    assert_eq!(reopened.get(id).unwrap().unwrap().result.unwrap(), ready());
    assert!(reopened.finish(id, &json!({"state":"rejected"})).is_err());
    reopened.record_unknown(id).unwrap();
    assert_eq!(reopened.get(id).unwrap().unwrap().state, "ready");
    // A fresh explicit attempt is possible after a known completed outcome.
    reopened.begin(Uuid::new_v4(), &f.plan).unwrap();
}

#[test]
fn isolates_library_workspace_scene_and_pages_complete_history() {
    let f = Fixture::new();
    let character = f.plan["characterId"].as_str().unwrap();
    let mut ids = Vec::new();
    for _ in 0..13 {
        let id = Uuid::new_v4();
        f.store.begin(id, &f.plan).unwrap();
        f.store.finish(id, &ready()).unwrap();
        ids.push(id);
    }
    let page = f.store.list(character, None).unwrap();
    assert_eq!(page["entries"].as_array().unwrap().len(), 10);
    let rest = f.store.list(character, page["next"].as_i64()).unwrap();
    assert_eq!(rest["entries"].as_array().unwrap().len(), 3);
    assert!(rest["next"].is_null());
    assert_eq!(page["entries"][0]["id"], ids[12].to_string());
    for store in [
        Store::open(
            &f.root,
            &Uuid::new_v4().to_string(),
            &f.store.workspace,
            &f.store.scene,
        )
        .unwrap(),
        Store::open(&f.root, &f.store.library, "other-workspace", &f.store.scene).unwrap(),
        Store::open(&f.root, &f.store.library, &f.store.workspace, "other-scene").unwrap(),
    ] {
        assert!(store.get(ids[0]).unwrap().is_none());
        assert!(store.list(character, None).unwrap()["entries"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(store.begin(Uuid::new_v4(), &f.plan).is_err());
        assert!(store.finish(ids[0], &ready()).is_err());
    }
}

#[test]
fn model_job_crash_child() {
    let Some(root) = std::env::var_os("ZICODE_MODEL_JOB_CRASH_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let request: Value =
        serde_json::from_slice(&std::fs::read(root.join("crash.json")).unwrap()).unwrap();
    let plan = &request["plan"];
    let store = Store::open(
        &root,
        plan["libraryId"].as_str().unwrap(),
        plan["evidence"]["workspaceId"].as_str().unwrap(),
        plan["sceneId"].as_str().unwrap(),
    )
    .unwrap();
    let phase = request["phase"].as_str().unwrap();
    let lease = store.lease().unwrap();
    if phase == "lease" {
        std::process::exit(if lease.is_none() { 88 } else { 89 });
    }
    let _lease = lease.unwrap();
    let id = Uuid::parse_str(request["id"].as_str().unwrap()).unwrap();
    let checkpoint = |name: &str| -> Result<()> {
        if name == phase {
            std::process::exit(86);
        }
        Ok(())
    };
    store.begin_checked(id, plan, &checkpoint).unwrap();
    store.finish_checked(id, &ready(), &checkpoint).unwrap();
    panic!("crash checkpoint was not reached");
}

fn child(f: &Fixture, id: Uuid, phase: &str) -> i32 {
    std::fs::write(
        f.root.join("crash.json"),
        json!({"plan":f.plan,"id":id,"phase":phase}).to_string(),
    )
    .unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact","visual_assets::novel_draft_commands::model_commands::jobs::tests::model_job_crash_child","--nocapture"])
        .env("ZICODE_MODEL_JOB_CRASH_ROOT",&f.root).creation_flags(0x08000000).output().unwrap();
    assert!(
        output.status.code().is_some(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    output.status.code().unwrap()
}

#[test]
fn survives_real_process_exits_on_both_sides_of_send_and_result_commits() {
    for phase in [
        "before-begin-commit",
        "after-begin-commit",
        "before-result-commit",
        "after-result-commit",
    ] {
        let f = Fixture::new();
        let id = Uuid::new_v4();
        assert_eq!(child(&f, id, phase), 86, "{phase}");
        let job = f.store.get(id).unwrap();
        match phase {
            "before-begin-commit" => assert!(job.is_none()),
            "after-result-commit" => assert_eq!(job.unwrap().result.unwrap(), ready()),
            _ => {
                assert_eq!(job.unwrap().state, "unknown");
                assert!(f.store.begin(Uuid::new_v4(), &f.plan).is_err());
            }
        }
        assert!(
            f.store.lease().unwrap().is_some(),
            "process lock was not released"
        );
    }
    let f = Fixture::new();
    let _lease = f.store.lease().unwrap().unwrap();
    assert_eq!(child(&f, Uuid::new_v4(), "lease"), 88);
}
