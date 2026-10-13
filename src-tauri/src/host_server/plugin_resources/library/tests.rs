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
fn archive_save_keeps_extension_and_reads_only_verified_bytes() {
    let fixture = Fixture::new();
    let id = uuid::Uuid::new_v4().to_string();
    let bytes = b"bounded archive output";
    let receipt = json!({"schemaVersion":1,"profile":"resource.save.draft1","saveId":id,
        "workspaceId":"ws-library","relativePath":format!(".zicode/outputs/{id}/result.tar.gz"),
        "mimeType":"application/x-zicode-archive-targzip","byteLength":bytes.len(),
        "contentVersion":sha256_hex(bytes),"preparedAt":"2026-10-14T00:00:00Z",
        "source":{"pluginId":"test.source","capabilityId":"archive.create","resourceId":uuid::Uuid::new_v4(),"packageVersion":"0.1.0"}});
    let staged = save_files::Staged::new(&fixture.root, &[Arc::from(bytes.as_slice())], &receipt, "tar.gz", &id).unwrap();
    staged.publish(&id).unwrap();
    drop(staged);
    let page = files::list(&fixture.root, "ws-library", "targzip", 0).unwrap();
    assert_eq!(page["total"], 1);
    let version = page["items"][0]["receiptVersion"].as_str().unwrap();
    assert_eq!(files::read(&fixture.root, "ws-library", &id, version).unwrap().0, bytes);
    let path = fixture.root.join(receipt["relativePath"].as_str().unwrap());
    fs::write(&path, b"changed archive output").unwrap();
    assert_eq!(files::read(&fixture.root, "ws-library", &id, version).unwrap_err().1.0["error"]["code"], "saved_output_changed");
}

#[test]
fn attempts_survive_stage_disposal_without_volatile_grants_and_never_authorize_replay() {
    let f=Fixture::new(); let mut receipt=f.save(b"abc"); let saved_id=receipt["saveId"].as_str().unwrap().to_string();
    let id=uuid::Uuid::new_v4().to_string(); receipt["saveId"]=json!(id); receipt["relativePath"]=json!(format!(".zicode/outputs/{id}/result.bin"));
    let staged=save_files::Staged::new(&f.root,&[Arc::from(b"abc".as_slice())],&receipt,"bin",&id).unwrap();
    assert_eq!(files::attempts(&f.root,"ws-library",&id,0).unwrap()["items"][0]["publication"],"not_observed");
    drop(staged);
    // Fresh discovery uses only disk, not Store, grant TTL, runtime or the source plugin.
    let page=files::attempts(&f.root,"ws-library","",0).unwrap(); assert_eq!(page["total"],2); assert_eq!(page["payloadsRead"],false);
    let pending=page["items"].as_array().unwrap().iter().find(|r|r["receipt"]["saveId"]==id).unwrap();
    assert_eq!(pending["receipt"],receipt); assert_eq!(pending["publication"],"not_observed");
    assert!(files::read(&f.root,"ws-library",&id,pending["receiptVersion"].as_str().unwrap()).is_err());
    assert!(save_files::Staged::new(&f.root,&[Arc::from(b"abc".as_slice())],&receipt,"bin",&id).is_err());
    assert_eq!(files::list(&f.root,"ws-library","",0).unwrap()["total"],1);
    assert!(!f.root.join(receipt["relativePath"].as_str().unwrap()).exists());
    assert!(f.root.join(format!(".zicode/outputs/{saved_id}/receipt.json")).is_file());
    assert_eq!(files::attempts(&f.root,"foreign","",0).unwrap()["total"],0);
}

#[test]
fn attempt_metadata_does_not_claim_file_integrity_and_never_masks_a_broken_published_receipt() {
    let f=Fixture::new(); let r=f.save(b"abc"); let id=r["saveId"].as_str().unwrap();
    let folder=f.root.join(".zicode/outputs").join(id);
    fs::write(folder.join("result.bin"),b"longer user edit").unwrap();
    assert_eq!(files::attempts(&f.root,"ws-library","",0).unwrap()["items"][0]["publication"],"observed");
    assert_eq!(files::list(&f.root,"ws-library","",0).unwrap()["total"],0);
    fs::write(folder.join(".receipt.pending"),serde_json::to_vec(&r).unwrap()).unwrap();
    assert!(save_files::quota(&f.root.join(".zicode/outputs"),0).is_ok(),"a crash between publication and pending-receipt disposal is bounded metadata, not a second payload");
    fs::write(folder.join("receipt.json"),b"broken").unwrap();
    assert_eq!(files::attempts(&f.root,"ws-library","",0).unwrap()["skippedEntries"],1);
    assert_eq!(fs::read(folder.join("result.bin")).unwrap(),b"longer user edit");
    fs::write(folder.join("result.txt"),b"second payload").unwrap();
    assert!(save_files::quota(&f.root.join(".zicode/outputs"),0).is_err());
}

#[test]
fn save_stage_crash_child() {
    let Some(path)=std::env::var_os("ZICODE_SAVE_CRASH_FIXTURE") else { return; };
    let workspace=PathBuf::from(path);
    let r: Value=serde_json::from_slice(&fs::read(workspace.join("crash-receipt.json")).unwrap()).unwrap();
    let staged=save_files::Staged::new(&workspace,&[Arc::from(b"abc".as_slice())],&r,"bin",r["saveId"].as_str().unwrap()).unwrap();
    assert!(workspace.join(".zicode/outputs").join(r["saveId"].as_str().unwrap()).join(".receipt.pending").is_file());
    // Exit this child process before Drop or publication, as a process-loss simulation.
    std::mem::forget(staged); std::process::exit(0);
}

#[test]
fn a_new_process_recovers_an_interrupted_stage_without_rewriting_or_publishing() {
    let f=Fixture::new(); let mut r=f.save(b"abc"); let id=uuid::Uuid::new_v4().to_string();
    r["saveId"]=json!(id); r["relativePath"]=json!(format!(".zicode/outputs/{id}/result.bin"));
    fs::write(f.root.join("crash-receipt.json"),serde_json::to_vec(&r).unwrap()).unwrap();
    let status=crate::process_command::new_command(std::env::current_exe().unwrap())
        .args(["host_server::plugin_resources::library::tests::save_stage_crash_child","--exact","--nocapture"])
        .env("ZICODE_SAVE_CRASH_FIXTURE",&f.root).status().unwrap(); assert!(status.success());
    let folder=f.root.join(".zicode/outputs").join(&id);
    let bytes_before=fs::read(folder.join("result.bin")).unwrap();
    let record_before=fs::read(folder.join(".receipt.pending")).unwrap();
    let recovered=files::attempts(&f.root,"ws-library",&id,0).unwrap();
    assert_eq!(recovered["items"][0]["receipt"],r); assert_eq!(recovered["items"][0]["publication"],"not_observed");
    assert_eq!(files::list(&f.root,"ws-library",&id,0).unwrap()["total"],0);
    assert_eq!(fs::read(folder.join("result.bin")).unwrap(),bytes_before);
    assert_eq!(fs::read(folder.join(".receipt.pending")).unwrap(),record_before);
    assert!(!folder.join("receipt.json").exists());
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
