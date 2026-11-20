use super::*;
fn fixture() -> (Context, Source, store::Record, Store) {
    let scope = Scope { workspace_id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc".into(), scene_id:"programming".into(), plugin_id:"test".into(), capability_id:"generate".into() };
    let context = Context { window:"main".into(), workspace:scope.workspace_id.clone(), route:"/app/workspaces/w/sessions/s".into() };
    let mut store = Store::default();
    let captured = store.capture(scope.clone(),"proof".into(),"1".into(),&json!({"ok":true,"data":{"text":"abc\n"}})).unwrap();
    let source = Source { scope, result_id:captured["resultId"].as_str().unwrap().into() };
    let record = store.record(&source.scope,&source.result_id).unwrap();
    (context,source,record,store)
}
#[test]
fn result_text_export_grants_bind_scope_route_window_and_expiry_without_writes() {
    let (context,source,record,mut store) = fixture();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch").join(format!("result-export-{}.txt",uuid::Uuid::new_v4()));
    let grant = store.exports.prepare(context.clone(),source.clone(),&record,Destination::prepare(path.clone()).unwrap()).unwrap();
    let id = grant["grantId"].as_str().unwrap();assert!(!path.exists());assert!(store.exports.get(&context,&source,id).is_ok());
    let mut foreign = context.clone();foreign.window="other".into();assert!(store.exports.get(&foreign,&source,id).is_err());
    foreign=context.clone();foreign.route.push('x');assert!(store.exports.get(&foreign,&source,id).is_err());
    let mut changed=source.clone();changed.scope.capability_id="other".into();assert!(store.exports.get(&context,&changed,id).is_err());
    store.exports.0.get_mut(id).unwrap().expires=Instant::now();assert!(store.exports.get(&context,&source,id).is_err());
    store.invalidate_workspace(&context.workspace);assert!(store.exports.0.is_empty());
}
#[test]
fn result_text_export_rejects_stale_proof_non_text_and_foreign_workspace() {
    let (context,source,mut record,_) = fixture();assert!(validate_record(&record,"proof").is_ok());assert!(validate_record(&record,"changed").is_err());
    record.mime_type="application/json";assert!(validate_record(&record,"proof").is_err());
    let value=json!({"scope":{"workspaceId":"other","sceneId":"programming","pluginId":"test","capabilityId":"generate"},"resultId":source.result_id});
    assert!(super::source(&context,value).is_err());
}
#[test]
fn result_text_export_reuses_atomic_no_overwrite_destination_and_full_verification() {
    let (_context,_source,record,_) = fixture();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch").join(format!("result-text-{}.txt",uuid::Uuid::new_v4()));
    let destination=Destination::prepare(path.clone()).unwrap();let version=sha256_hex(record.text.as_bytes());let chunks:Vec<Arc<[u8]>>=vec![Arc::from(record.text.as_bytes())];
    Staged::new(&destination,&chunks,record.text.len(),&version).unwrap().publish().unwrap();
    assert_eq!(std::fs::read(&path).unwrap(),record.text.as_bytes());destination.verify(record.text.len(),&version).unwrap();
    assert!(Destination::prepare(path.clone()).is_err());assert!(Staged::new(&destination,&chunks,record.text.len(),&version).unwrap().publish().is_err());
    std::fs::remove_file(path).unwrap();
}
