use super::*;

fn fixture() -> (Store, Access, Owner) {
    let mut store = Store::default();
    let owner = Owner {
        runtime_id: "r".into(),
        session_id: "s".into(),
        plugin_id: "a".into(),
        capability_id: "one".into(),
    };
    let version = sha256_hex(b"immutable");
    let row = store
        .prepare(
            Prepare { catalog_revision: None,
                schema_version: 1,
                owner: owner.clone(),
                mime_type: "text/plain".into(),
                byte_length: 9,
                content_version: version.clone(),
            },
            "source".into(),
        )
        .unwrap();
    let access = Access {
        schema_version: 1,
        owner: owner.clone(),
        resource_id: row["resourceId"].as_str().unwrap().into(),
        content_version: version,
    };
    store
        .append(&access, "source", 0, b"immutable".to_vec())
        .unwrap();
    store.commit(&access, "source").unwrap();
    let target = Owner {
        plugin_id: "b".into(),
        capability_id: "two".into(),
        ..owner
    };
    (store, access, target)
}
fn grant(store: &mut Store, source: &Access, target: &Owner) -> String {
    store
        .prepare_transfer(source, "source", target.clone(), "target".into())
        .unwrap()["grantId"]
        .as_str()
        .unwrap()
        .into()
}
fn delegated(row: &Value, target: &Owner) -> Access {
    Access {
        schema_version: 1,
        owner: target.clone(),
        resource_id: row["reference"]["resourceId"].as_str().unwrap().into(),
        content_version: row["reference"]["contentVersion"].as_str().unwrap().into(),
    }
}

#[test]
fn preparation_grants_no_read_and_commit_is_owner_specific_and_replay_safe() {
    let (mut store, source, target) = fixture();
    let id = grant(&mut store, &source, &target);
    assert_eq!(store.records.len(), 1);
    let mut foreign = source.clone();
    foreign.owner = target.clone();
    assert!(store.read(&foreign, "target", 0, 1).is_err());
    assert!(store
        .commit_transfer(&foreign, &id, "source", "target")
        .is_err());
    assert!(store
        .commit_transfer(&source, &id, "source", "changed")
        .is_err());
    let result = store
        .commit_transfer(&source, &id, "source", "target")
        .unwrap();
    let access = delegated(&result, &target);
    assert_eq!(
        store.read(&access, "target", 0, 9).unwrap()["dataBase64"],
        "aW1tdXRhYmxl"
    );
    assert!(store.read(&access, "source", 0, 1).is_err());
    assert!(Arc::ptr_eq(
        &store.records[&source.resource_id].chunks[0],
        &store.records[&access.resource_id].chunks[0]
    ));
    let replay = store
        .commit_transfer(&source, &id, "source", "target")
        .unwrap();
    assert_eq!(result["reference"], replay["reference"]);
    assert_eq!(replay["replayed"], true);
    assert_eq!(store.records.len(), 2);
}
#[test]
fn ancestry_tracks_different_proofs_and_cascades_through_transfer_and_output() {
    let (mut store, source, target) = fixture();
    let id = grant(&mut store, &source, &target);
    let row = store
        .commit_transfer(&source, &id, "source", "target")
        .unwrap();
    let access = delegated(&row, &target);
    let rows = store
        .register_outputs(
            &access,
            "target",
            vec![crate::plugin_worker::resource_output::Blob {
                mime_type: "text/plain".into(),
                bytes: b"next".to_vec(),
            }],
        )
        .unwrap();
    let output = Access {
        resource_id: rows[0]["resourceId"].as_str().unwrap().into(),
        content_version: rows[0]["contentVersion"].as_str().unwrap().into(),
        ..access.clone()
    };
    let ancestors = store.lineage(&output, "target").unwrap();
    assert_eq!(ancestors.len(), 2);
    assert_eq!(ancestors[1].1, "source");
    store.revoke(&source).unwrap();
    assert!(store.check(&access, "target").is_err());
    assert!(store.check(&output, "target").is_err());
    assert!(store
        .commit_transfer(&source, &id, "source", "target")
        .is_err());
}
#[test]
fn expiry_source_changes_and_target_revoke_never_resurrect_transferred_bytes() {
    let (mut store, source, target) = fixture();
    let id = grant(&mut store, &source, &target);
    store.transfers.get_mut(&id).unwrap().expires = Instant::now() - Duration::from_secs(1);
    assert!(store
        .commit_transfer(&source, &id, "source", "target")
        .is_err());
    let id = grant(&mut store, &source, &target);
    let row = store
        .commit_transfer(&source, &id, "source", "target")
        .unwrap();
    let access = delegated(&row, &target);
    store.revoke(&access).unwrap();
    assert!(store
        .commit_transfer(&source, &id, "source", "target")
        .is_err());
    let id = grant(&mut store, &source, &target);
    assert!(store
        .commit_transfer(&source, &id, "newsource", "target")
        .is_err());
    store.records.get_mut(&source.resource_id).unwrap().expires =
        Instant::now() - Duration::from_secs(1);
    assert!(store
        .commit_transfer(&source, &id, "source", "target")
        .is_err());
}
#[test]
fn scope_grants_and_publication_remain_bounded() {
    let (mut store, source, target) = fixture();
    for invalid in [
        source.owner.clone(),
        Owner {
            runtime_id: "other".into(),
            ..target.clone()
        },
        Owner {
            session_id: "other".into(),
            ..target.clone()
        },
    ] {
        assert!(store
            .prepare_transfer(&source, "source", invalid, "target".into())
            .is_err());
    }
    for _ in 0..MAX_GRANTS {
        grant(&mut store, &source, &target);
    }
    assert!(store
        .prepare_transfer(&source, "source", target.clone(), "target".into())
        .is_err());
    let id = store.transfers.keys().next().unwrap().clone();
    for _ in 1..MAX_RECORDS {
        store
            .prepare(
                Prepare { catalog_revision: None,
                    schema_version: 1,
                    owner: target.clone(),
                    mime_type: "text/plain".into(),
                    byte_length: 0,
                    content_version: sha256_hex(b""),
                },
                "target".into(),
            )
            .unwrap();
    }
    assert_eq!(
        store
            .commit_transfer(&source, &id, "source", "target")
            .unwrap_err()
            .1
             .0["error"]["code"],
        "resource_budget_exceeded"
    );
    assert!(store.transfers[&id].result.is_none());
}

#[test]
fn byte_quota_is_checked_at_confirmation_and_failure_does_not_consume_grant() {
    let (mut store, source, target) = fixture();
    let id = grant(&mut store, &source, &target);
    let mut reservations = Vec::new();
    for length in [MAX_RESOURCE, MAX_RESOURCE, MAX_RESOURCE, MAX_RESOURCE - 17] {
        let row = store
            .prepare(
                Prepare { catalog_revision: None,
                    schema_version: 1,
                    owner: target.clone(),
                    mime_type: "application/octet-stream".into(),
                    byte_length: length,
                    content_version: sha256_hex(b"reserved"),
                },
                "target".into(),
            )
            .unwrap();
        reservations.push(Access {
            schema_version: 1,
            owner: target.clone(),
            resource_id: row["resourceId"].as_str().unwrap().into(),
            content_version: sha256_hex(b"reserved"),
        });
    }
    assert_eq!(
        store
            .commit_transfer(&source, &id, "source", "target")
            .unwrap_err()
            .1
             .0["error"]["code"],
        "resource_budget_exceeded"
    );
    assert!(store.transfers[&id].result.is_none());
    store.revoke(&reservations[0]).unwrap();
    assert!(store
        .commit_transfer(&source, &id, "source", "target")
        .is_ok());
}
