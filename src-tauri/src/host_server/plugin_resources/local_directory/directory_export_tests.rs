use super::*;
use crate::host_server::HostServer;

pub(super) fn assert_directory_json_export(
    host: &HostServer,
    context: &Context,
    owner: &Value,
    source: &Value,
    response: &Value,
    path: &Path,
    alternate: Option<&Value>,
) -> Value {
    let descriptor = &response["reportResource"];
    assert_eq!(descriptor["mimeType"], "application/json");
    assert_eq!(descriptor["origin"], "host-report");
    assert_eq!(descriptor["saved"], false);
    assert_eq!(
        descriptor["derivedFrom"]["resourceId"],
        source["resourceId"]
    );
    assert_eq!(
        descriptor["derivedFrom"]["contentVersion"],
        source["contentVersion"]
    );
    let access = json!({
        "schemaVersion":1, "owner":owner,
        "resourceId":descriptor["resourceId"], "contentVersion":descriptor["contentVersion"]
    });
    let grant = host
        .prepare_resource_export(context.clone(), access.clone(), path.to_path_buf())
        .unwrap();
    let id = grant["grantId"].as_str().unwrap();
    assert!(!path.exists());
    assert_eq!(
        host.commit_resource_export(context.clone(), access.clone(), id.into(), false)
            .unwrap_err(),
        "resource_confirmation_required"
    );
    let wrong_window = Context {
        window: "another-window".into(),
        ..context.clone()
    };
    assert!(host
        .commit_resource_export(wrong_window, access.clone(), id.into(), true)
        .is_err());
    if let Some(other) = alternate {
        assert!(host
            .commit_resource_export(context.clone(), other.clone(), id.into(), true)
            .is_err());
    }
    assert!(!path.exists());
    let receipt = host
        .commit_resource_export(context.clone(), access.clone(), id.into(), true)
        .unwrap();
    let bytes = std::fs::read(path).unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&bytes).unwrap(),
        response["result"]
    );
    assert_eq!(sha256_hex(&bytes), descriptor["contentVersion"]);
    assert_eq!(receipt["receipt"]["byteLength"], bytes.len());
    assert_eq!(
        host.verify_resource_export(context.clone(), access.clone(), id.into())
            .unwrap()["status"],
        "verified"
    );
    assert!(host
        .commit_resource_export(context.clone(), access.clone(), id.into(), true)
        .is_err());
    assert!(host
        .prepare_resource_export(context.clone(), access.clone(), path.to_path_buf())
        .is_err());
    println!("DIRECTORY_REPORT_SAVED {} bytes", bytes.len());
    access
}

pub(super) fn assert_directory_export_cancel_and_conflict(
    host: &HostServer,
    context: &Context,
    access: &Value,
    destination: &Path,
) {
    let cancelled_path = destination.join("cancelled.json");
    let cancelled = host
        .prepare_resource_export(context.clone(), access.clone(), cancelled_path.clone())
        .unwrap();
    let id = cancelled["grantId"].as_str().unwrap();
    host.cancel_resource_export(context.clone(), access.clone(), id.into())
        .unwrap();
    assert!(host
        .commit_resource_export(context.clone(), access.clone(), id.into(), true)
        .is_err());
    assert!(!cancelled_path.exists());

    let racing_path = destination.join("racing.json");
    let racing = host
        .prepare_resource_export(context.clone(), access.clone(), racing_path.clone())
        .unwrap();
    let id = racing["grantId"].as_str().unwrap();
    std::fs::write(&racing_path, b"other program wrote first").unwrap();
    assert!(host
        .commit_resource_export(context.clone(), access.clone(), id.into(), true)
        .is_err());
    assert_eq!(
        std::fs::read(racing_path).unwrap(),
        b"other program wrote first"
    );
}
