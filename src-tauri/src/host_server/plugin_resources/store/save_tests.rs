use super::*;
fn source(store: &mut Store) -> Access {
    let owner = Owner { runtime_id:"r".into(),session_id:"s".into(),plugin_id:"p".into(),capability_id:"c".into() };
    let version = sha256_hex(b"hello");
    let prepared = store.prepare(Prepare { catalog_revision: None, schema_version:1,owner:owner.clone(),mime_type:"text/plain".into(),byte_length:5,content_version:version.clone() }, "proof".into()).unwrap();
    let access = Access { schema_version:1,owner,resource_id:prepared["resourceId"].as_str().unwrap().into(),content_version:version };
    store.append(&access,"proof",0,b"hello".to_vec()).unwrap(); store.commit(&access,"proof").unwrap(); access
}
#[test]
fn save_grants_bind_source_destination_proof_expiry_and_limit() {
    let mut store = Store::default(); let source = source(&mut store);
    let prepare = |store: &mut Store| store.prepare_save(&source,"proof","destination".into(),std::path::PathBuf::from("unused"),"workspace","0.1.0");
    let result = prepare(&mut store).unwrap(); let id = result["grantId"].as_str().unwrap();
    assert!(!store.save_grant(&source,id,"proof","destination").unwrap().saved);
    assert!(store.save_grant(&source,id,"proof","changed").is_err());
    let mut other = source.clone(); other.owner.plugin_id = "other".into(); assert!(store.save_grant(&other,id,"proof","destination").is_err());
    store.mark_saved(id); assert!(store.save_grant(&source,id,"proof","destination").unwrap().saved);
    for _ in 1..16 { prepare(&mut store).unwrap(); }
    assert!(prepare(&mut store).is_err());
    store.saves.get_mut(id).unwrap().expires = Instant::now() - Duration::from_secs(1);
    assert!(store.save_grant(&source,id,"proof","destination").is_err());
    prepare(&mut store).unwrap();
    store.revoke(&source).unwrap(); assert!(prepare(&mut store).is_err());
}

#[test]
fn derived_archive_output_prepares_a_named_confirmed_save() {
    let mut store = Store::default();
    let source = source(&mut store);
    let rows = store.register_outputs(&source, "proof", vec![
        crate::plugin_worker::resource_output::Blob {
            mime_type: "application/x-zicode-archive-targzip".into(),
            bytes: b"archive-bytes".to_vec(),
        },
    ]).unwrap();
    let output = &rows[0];
    let access = Access {
        schema_version: 1,
        owner: source.owner.clone(),
        resource_id: output["resourceId"].as_str().unwrap().into(),
        content_version: output["contentVersion"].as_str().unwrap().into(),
    };
    let result = store.prepare_save(&access, "proof", "destination".into(),
        std::path::PathBuf::from("unused"), "workspace", "0.1.0").unwrap();
    assert_eq!(result["operation"], "create_new_file");
    assert_eq!(result["requiresConfirmation"], true);
    assert!(result["preview"]["relativePath"].as_str().unwrap().ends_with("/result.tar.gz"));
    assert_eq!(result["preview"]["mimeType"], "application/x-zicode-archive-targzip");
}
