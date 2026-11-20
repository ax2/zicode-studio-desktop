use super::*;
fn fixture() -> (Context, Access, store::Store) {
    let context = Context {
        window: "main".into(),
        workspace: "w".into(),
        route: "/app/workspaces/w/sessions/s".into(),
    };
    let mut store = Store::default();
    let owner = Owner {
        runtime_id: "r".into(),
        session_id: "s".into(),
        plugin_id: "p".into(),
        capability_id: "c".into(),
    };
    let input = store
        .import_file(
            owner.clone(),
            "proof".into(),
            b"source".to_vec(),
            "text/plain",
        )
        .unwrap();
    let access = Access {
        schema_version: 1,
        owner,
        resource_id: input["resourceId"].as_str().unwrap().into(),
        content_version: input["contentVersion"].as_str().unwrap().into(),
    };
    (context, access, store)
}
#[test]
fn resource_export_only_derived_confirmed_outputs_are_admitted() {
    let (_, input, mut store) = fixture();
    assert!(store.export_metadata(&input, "proof").is_err());
    let out = store
        .register_outputs(
            &input,
            "proof",
            vec![crate::plugin_worker::resource_output::Blob {
                mime_type: "text/html".into(),
                bytes: b"<p>abc</p>".to_vec(),
            }],
        )
        .unwrap();
    let access = Access {
        resource_id: out[0]["resourceId"].as_str().unwrap().into(),
        content_version: out[0]["contentVersion"].as_str().unwrap().into(),
        ..input.clone()
    };
    let meta = store.export_metadata(&access, "proof").unwrap();
    assert_eq!(meta["extension"], "html");
    assert_eq!(meta["byteLength"], 10);
    assert!(store.export_metadata(&access, "other").is_err());
    store.revoke(&input).unwrap();
    assert!(store.export_metadata(&access, "proof").is_err());
}
#[test]
fn resource_export_grants_bind_exact_window_route_owner_content_and_expiry() {
    let (context, source, _) = fixture();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let destination = export_files::Destination::prepare(
        root.join(format!("export-{}.html", uuid::Uuid::new_v4())),
    )
    .unwrap();
    let mut grants = Grants::default();
    let prepared = grants
        .prepare(
            context.clone(),
            source.clone(),
            "proof".into(),
            destination,
            json!({"mimeType":"text/html","byteLength":0}),
        )
        .unwrap();
    let id = prepared["grantId"].as_str().unwrap();
    assert!(grants.get(&context, &source, id).is_ok());
    let mut other = context.clone();
    other.window = "other".into();
    assert!(grants.get(&other, &source, id).is_err());
    other = context.clone();
    other.route.push('x');
    assert!(grants.get(&other, &source, id).is_err());
    let mut other = source.clone();
    other.owner.session_id = "foreign".into();
    assert!(grants.get(&context, &other, id).is_err());
    other = source.clone();
    other.content_version = sha256_hex(b"other");
    assert!(grants.get(&context, &other, id).is_err());
    grants.0.get_mut(id).unwrap().expires = Instant::now();
    assert!(grants.get(&context, &source, id).is_err());
    grants.invalidate_runtime("r");
    assert!(grants.0.is_empty());
}
