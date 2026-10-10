use super::*;
use std::fs;
pub(in crate::host_server::plugin_resources) mod http;
struct Fixture { root: PathBuf }
impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch").join(format!("saved-library-unit-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap(); fs::write(root.join("owner.json"), br#"{"purpose":"saved library unit; remove own fixture on success"}"#).unwrap(); Self { root }
    }
    fn save(&self, bytes: &[u8]) -> Value {
        let id=uuid::Uuid::new_v4().to_string();
        let receipt=json!({"schemaVersion":1,"profile":"resource.save.draft1","saveId":id,"workspaceId":"ws-library",
            "relativePath":format!(".zicode/outputs/{id}/result.bin"),"mimeType":"application/octet-stream","byteLength":bytes.len(),
            "contentVersion":sha256_hex(bytes),"preparedAt":"2026-10-10T02:00:00Z","source":{"pluginId":"test.source","capabilityId":"copy","resourceId":uuid::Uuid::new_v4(),"packageVersion":"0.1.0"}});
        let staged=save_files::Staged::new(&self.root,&[Arc::from(bytes)],&receipt,"bin",&id).unwrap(); staged.publish(&id).unwrap(); drop(staged); receipt
    }
}
impl Drop for Fixture { fn drop(&mut self) { if !std::thread::panicking() {
    let scratch=PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch").canonicalize().unwrap();
    assert!(self.root.canonicalize().unwrap().starts_with(scratch)); fs::remove_dir_all(&self.root).unwrap();
} } }
#[test]
fn listing_empty_workspace_does_not_create_storage() {
    let f=Fixture::new(); let page=files::list(&f.root,"ws-library","",0).unwrap(); assert_eq!(page["total"],0); assert!(!f.root.join(".zicode").exists());
}
#[test]
fn listing_is_metadata_only_and_read_checks_raw_hash_receipt_and_workspace() {
    let f=Fixture::new(); let r=f.save(b"abc"); let id=r["saveId"].as_str().unwrap();
    let page=files::list(&f.root,"ws-library","test.source",0).unwrap(); assert_eq!(page["payloadsRead"],false); assert_eq!(page["items"][0]["integrity"],"not_checked");
    let version=page["items"][0]["receiptVersion"].as_str().unwrap();
    assert_eq!(files::read(&f.root,"ws-library",id,version).unwrap().0,b"abc");
    assert_eq!(files::list(&f.root,"foreign","",0).unwrap()["skippedEntries"],1);
    assert!(files::read(&f.root,"foreign",id,version).is_err());
    fs::write(f.root.join(r["relativePath"].as_str().unwrap()),b"xyz").unwrap();
    assert_eq!(files::list(&f.root,"ws-library","",0).unwrap()["total"],1,"same-size edits are not silently labeled verified");
    assert_eq!(files::read(&f.root,"ws-library",id,version).unwrap_err().1.0["error"]["code"],"saved_output_changed");
    assert_eq!(fs::read(f.root.join(r["relativePath"].as_str().unwrap())).unwrap(),b"xyz");
}
#[test]
fn metadata_replacement_paths_unknown_fields_and_unpublished_entries_are_rejected() {
    let f=Fixture::new(); let mut r=f.save(b"abc"); let id=r["saveId"].as_str().unwrap().to_string();
    let old=files::list(&f.root,"ws-library","",0).unwrap()["items"][0]["receiptVersion"].as_str().unwrap().to_string();
    let path=f.root.join(".zicode/outputs").join(&id).join("receipt.json");
    r["source"]["packageVersion"]=json!("0.2.0"); fs::write(&path,serde_json::to_vec(&r).unwrap()).unwrap();
    assert!(files::read(&f.root,"ws-library",&id,&old).is_err());
    r["relativePath"]=json!("../outside"); fs::write(&path,serde_json::to_vec(&r).unwrap()).unwrap();
    assert_eq!(files::list(&f.root,"ws-library","",0).unwrap()["skippedEntries"],1);
    r["relativePath"]=json!(format!(".zicode/outputs/{id}/result.bin")); r["path"]=json!("private");fs::write(&path,serde_json::to_vec(&r).unwrap()).unwrap();
    assert_eq!(files::list(&f.root,"ws-library","",0).unwrap()["total"],0);
    fs::remove_file(&path).unwrap(); assert_eq!(files::list(&f.root,"ws-library","",0).unwrap()["total"],0);
    assert!(files::read(&f.root,"ws-library","../outside",&old).is_err());
}
#[test]
fn bounded_catalog_search_paging_and_overflow_do_not_read_payloads_or_delete_data() {
    let f=Fixture::new(); for _ in 0..41 { f.save(b"a"); }
    let first=files::list(&f.root,"ws-library","SOURCE",0).unwrap(); let next=files::list(&f.root,"ws-library","",40).unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(),40); assert_eq!(first["hasMore"],true); assert_eq!(next["items"].as_array().unwrap().len(),1);
    let root=f.root.join(".zicode/outputs"); for _ in 41..129 { fs::create_dir(root.join(uuid::Uuid::new_v4().to_string())).unwrap(); }
    assert_eq!(files::list(&f.root,"ws-library","",0).unwrap_err().1.0["error"]["code"],"resource_save_quota_exceeded");
    assert_eq!(fs::read_dir(root).unwrap().count(),129);
}
#[test]
fn query_decoders_reject_filesystem_overrides() {
    let valid=json!({"schemaVersion":1,"sceneId":"programming","workspaceId":"ws-library","query":"","offset":0});
    assert!(serde_json::from_value::<ListQuery>(valid.clone()).is_ok());let mut invalid=valid;invalid["path"]=json!("private"); assert!(serde_json::from_value::<ListQuery>(invalid).is_err());
    let invalid=json!({"schemaVersion":1,"sceneId":"programming","workspaceId":"ws-library","saveId":uuid::Uuid::new_v4(),"receiptVersion":"a".repeat(64),"path":"private"});
    assert!(serde_json::from_value::<ReadQuery>(invalid).is_err());
}
