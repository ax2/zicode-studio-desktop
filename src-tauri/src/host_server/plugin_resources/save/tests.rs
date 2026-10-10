use super::*;
use std::fs;
pub(in crate::host_server::plugin_resources) mod http;
pub(in crate::host_server::plugin_resources) mod publication;
struct Fixture { root: PathBuf }
impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch").join(format!("resource-save-unit-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("owner.json"), br#"{"purpose":"resource save unit evidence; remove on success"}"#).unwrap();
        Self { root }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch").canonicalize().unwrap();
            assert!(self.root.canonicalize().unwrap().starts_with(scratch));
            fs::remove_dir_all(&self.root).unwrap();
        }
    }
}
fn receipt(bytes: &[u8]) -> Value { json!({"byteLength":bytes.len(),"contentVersion":sha256_hex(bytes)}) }

#[test]
fn strict_save_requests_cannot_supply_paths_scope_or_unconfirmed_overrides() {
    let source = json!({"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"},"resourceId":uuid::Uuid::new_v4(),"contentVersion":"a".repeat(64)});
    let prepare = json!({"schemaVersion":1,"source":source});
    assert!(serde_json::from_value::<PrepareSave>(prepare.clone()).is_ok());
    for key in ["path", "workspaceId", "title", "overwrite"] {
        let mut value = prepare.clone(); value[key] = json!("forbidden");
        assert!(serde_json::from_value::<PrepareSave>(value).is_err());
    }
    let commit = json!({"schemaVersion":1,"source":source,"grantId":uuid::Uuid::new_v4(),"confirmed":true});
    assert!(serde_json::from_value::<CommitSave>(commit.clone()).is_ok());
    let mut invalid = commit; invalid["target"] = json!({}); assert!(serde_json::from_value::<CommitSave>(invalid).is_err());
}
#[test]
fn raw_export_publishes_exact_bytes_receipt_and_replays_without_rewrite() {
    let fixture = Fixture::new(); let bytes = vec![173; 300000]; let receipt = receipt(&bytes);
    let id = uuid::Uuid::new_v4().to_string();
    let chunks = bytes.chunks(65536).map(Arc::from).collect::<Vec<_>>();
    let staged = save_files::Staged::new(&fixture.root, &chunks, &receipt, "bin", &id).unwrap();
    assert!(!fixture.root.join(".zicode/outputs").join(&id).join("receipt.json").exists());
    staged.publish(&id).unwrap(); drop(staged);
    let path = fixture.root.join(".zicode/outputs").join(&id).join("result.bin");
    assert_eq!(fs::read(&path).unwrap(), bytes);
    save_files::replay(&fixture.root, &id, &receipt, "bin").unwrap();
    fs::write(&path, b"user edit").unwrap();
    assert!(save_files::replay(&fixture.root, &id, &receipt, "bin").is_err());
    assert_eq!(fs::read(path).unwrap(), b"user edit");
}
#[test]
fn abandoned_stage_cleans_only_its_files_and_conflict_does_not_overwrite() {
    let fixture = Fixture::new(); let chunks = vec![Arc::from(b"hello".as_slice())];
    let staged = save_files::Staged::new(&fixture.root, &chunks, &receipt(b"hello"), "txt", &uuid::Uuid::new_v4().to_string()).unwrap(); drop(staged);
    let root = fixture.root.join(".zicode/outputs"); assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
    let id = uuid::Uuid::new_v4().to_string(); fs::create_dir(root.join(&id)).unwrap(); fs::write(root.join(&id).join("keep.txt"), b"preserved").unwrap();
    assert!(save_files::Staged::new(&fixture.root, &chunks, &receipt(b"hello"), "txt", &id).is_err());
    assert_eq!(fs::read(root.join(id).join("keep.txt")).unwrap(), b"preserved");
}
#[test]
fn metadata_hash_unsafe_directory_and_unmanaged_files_fail_closed() {
    let fixture = Fixture::new(); let chunks = vec![Arc::from(b"hello".as_slice())];
    assert!(save_files::Staged::new(&fixture.root, &chunks, &receipt(b"wrong"), "txt", &uuid::Uuid::new_v4().to_string()).is_err());
    assert_eq!(fs::read_dir(fixture.root.join(".zicode/outputs")).unwrap().count(), 0);
    assert!(save_files::Staged::new(&fixture.root, &chunks, &receipt(b"hello"), "../escape", &uuid::Uuid::new_v4().to_string()).is_err());
    let outputs = fixture.root.join(".zicode/outputs"); fs::write(outputs.join("unmanaged.bin"), b"keep").unwrap();
    assert!(save_files::quota(&outputs, 0).is_err());
    assert_eq!(fs::read(outputs.join("unmanaged.bin")).unwrap(), b"keep");
    let another = Fixture::new(); fs::write(another.root.join(".zicode"), b"file").unwrap();
    assert!(save_files::location(&another.root, false).is_err());
}
#[test]
fn quota_rejects_unbounded_folder_counts() {
    let fixture = Fixture::new(); let root = save_files::location(&fixture.root, true).unwrap();
    for _ in 0..128 { fs::create_dir(root.join(uuid::Uuid::new_v4().to_string())).unwrap(); }
    assert!(save_files::quota(&root, 1).is_err());
}
