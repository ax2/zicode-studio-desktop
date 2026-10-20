use super::*;

fn prepared(store: &mut Store, data: &[u8]) -> Access {
    let owner = Owner {
        runtime_id: "r".into(),
        session_id: "s".into(),
        plugin_id: "p".into(),
        capability_id: "c".into(),
    };
    let version = sha256_hex(data);
    let response = store
        .prepare(
            Prepare {
                catalog_revision: None,
                schema_version: 1,
                owner: owner.clone(),
                mime_type: "application/octet-stream".into(),
                byte_length: data.len(),
                content_version: version.clone(),
            },
            "proof".into(),
        )
        .unwrap();
    Access {
        schema_version: 1,
        owner,
        resource_id: response["resourceId"].as_str().unwrap().into(),
        content_version: version,
    }
}

#[test]
fn immutable_chunks_ranges_confirmation_and_content_mismatch() {
    let mut store = Store::default();
    let access = prepared(&mut store, b"abcdef");
    assert!(store.read(&access, "proof", 0, 1).is_err());
    assert!(store.commit(&access, "proof").is_err());
    store.append(&access, "proof", 0, b"abc".to_vec()).unwrap();
    assert!(store.append(&access, "proof", 0, b"abc".to_vec()).is_err());
    store.append(&access, "proof", 3, b"def".to_vec()).unwrap();
    store.commit(&access, "proof").unwrap();
    store.commit(&access, "proof").unwrap();
    assert_eq!(
        store.read(&access, "proof", 2, 3).unwrap()["dataBase64"],
        "Y2Rl"
    );
    assert_eq!(
        store.read(&access, "proof", 6, 1).unwrap()["dataBase64"],
        ""
    );
    assert!(store.read(&access, "proof", usize::MAX, 1).is_err());
    assert!(store.read(&access, "proof", 0, MAX_CHUNK + 1).is_err());
    assert!(store.append(&access, "proof", 6, vec![1]).is_err());
    let bad = prepared(&mut store, b"expected");
    store
        .append(&bad, "proof", 0, b"tampered".to_vec())
        .unwrap();
    assert!(store.commit(&bad, "proof").is_err());
}

#[test]
fn worker_snapshots_preserve_confirmation_proof_version_and_revocation() {
    let mut store = Store::default();
    let mut access = prepared(&mut store, b"resource");
    assert!(store.snapshot(&access, "proof").is_err());
    store
        .append(&access, "proof", 0, b"resource".to_vec())
        .unwrap();
    store.commit(&access, "proof").unwrap();
    assert!(store.snapshot(&access, "new-proof").is_err());
    let snapshot = store.snapshot(&access, "proof").unwrap();
    assert_eq!(snapshot.bytes, b"resource");
    assert_eq!(snapshot.descriptor.content_version, access.content_version);
    access.owner.session_id = "foreign".into();
    assert!(store.snapshot(&access, "proof").is_err());
    access.owner.session_id = "s".into();
    store.revoke(&access).unwrap();
    assert!(store.snapshot(&access, "proof").is_err());
    // Revocation prevents new snapshots; it cannot withdraw already copied bytes.
    assert_eq!(snapshot.bytes, b"resource");
}

#[test]
fn scope_proof_expiry_revoke_and_empty_resource() {
    let mut store = Store::default();
    let mut access = prepared(&mut store, b"");
    store.commit(&access, "proof").unwrap();
    assert_eq!(store.read(&access, "proof", 0, 1).unwrap()["eof"], true);
    assert!(store.read(&access, "new-proof", 0, 1).is_err());
    access.owner.runtime_id = "foreign".into();
    assert!(store.revoke(&access).is_err());
    access.owner.runtime_id = "r".into();
    store.records.get_mut(&access.resource_id).unwrap().expires =
        Instant::now() - Duration::from_secs(1);
    assert!(store.read(&access, "proof", 0, 1).is_err());
    assert!(store.records.is_empty());
    store.revoke(&access).unwrap();
}

#[test]
fn reserved_budget_counts_unuploaded_bytes_and_record_limit() {
    let mut fragmented = Store::default();
    let access = prepared(&mut fragmented, &[1; MAX_CHUNKS + 1]);
    for offset in 0..MAX_CHUNKS {
        fragmented
            .append(&access, "proof", offset, vec![1])
            .unwrap();
    }
    assert!(fragmented
        .append(&access, "proof", MAX_CHUNKS, vec![1])
        .is_err());
    let mut store = Store::default();
    for _ in 0..4 {
        let mut req = Prepare {
            catalog_revision: None,
            schema_version: 1,
            owner: Owner {
                runtime_id: "r".into(),
                session_id: "s".into(),
                plugin_id: "p".into(),
                capability_id: "c".into(),
            },
            mime_type: "image/png".into(),
            byte_length: MAX_RESOURCE,
            content_version: sha256_hex(b"not-uploaded"),
        };
        store.prepare(req, "proof".into()).unwrap();
        req = Prepare {
            catalog_revision: None,
            schema_version: 1,
            owner: Owner {
                runtime_id: "r".into(),
                session_id: "s".into(),
                plugin_id: "p".into(),
                capability_id: "c".into(),
            },
            mime_type: "image/png".into(),
            byte_length: MAX_RESOURCE + 1,
            content_version: sha256_hex(b""),
        };
        assert!(store.prepare(req, "proof".into()).is_err());
    }
    assert!(store
        .prepare(
            Prepare {
                catalog_revision: None,
                schema_version: 1,
                owner: Owner {
                    runtime_id: "r".into(),
                    session_id: "s".into(),
                    plugin_id: "p".into(),
                    capability_id: "c".into()
                },
                mime_type: "image/png".into(),
                byte_length: 1,
                content_version: sha256_hex(b"x")
            },
            "proof".into()
        )
        .is_err());
    let mut empty = Store::default();
    for _ in 0..MAX_RECORDS {
        prepared(&mut empty, b"");
    }
    assert_eq!(empty.records.len(), MAX_RECORDS);
}

#[test]
fn derived_outputs_are_atomic_scoped_immutable_and_follow_source_revocation() {
    use crate::plugin_worker::resource_output::Blob;
    let mut store = Store::default();
    let source = prepared(&mut store, b"input");
    assert!(store.register_outputs(&source, "proof", vec![]).is_err());
    store
        .append(&source, "proof", 0, b"input".to_vec())
        .unwrap();
    store.commit(&source, "proof").unwrap();
    let blob = || Blob {
        mime_type: "application/octet-stream".into(),
        bytes: vec![173; 100000],
    };
    assert!(store
        .register_outputs(&source, "changed", vec![blob()])
        .is_err());
    let results = store
        .register_outputs(
            &source,
            "proof",
            vec![
                blob(),
                Blob {
                    mime_type: "text/plain".into(),
                    bytes: vec![],
                },
            ],
        )
        .unwrap();
    let child = Access {
        schema_version: 1,
        owner: source.owner.clone(),
        resource_id: results[0]["resourceId"].as_str().unwrap().into(),
        content_version: results[0]["contentVersion"].as_str().unwrap().into(),
    };
    assert_eq!(
        store.snapshot(&child, "proof").unwrap().bytes,
        vec![173; 100000]
    );
    assert_eq!(
        store.read(&child, "proof", 99999, 10).unwrap()["byteLength"],
        1
    );
    assert!(store.append(&child, "proof", 100000, vec![1]).is_err());
    let mut foreign = child;
    foreign.owner.capability_id = "other".into();
    assert!(store.snapshot(&foreign, "proof").is_err());
    foreign.owner = source.owner.clone();
    let grandchild = store
        .register_outputs(&foreign, "proof", vec![blob()])
        .unwrap();
    assert_eq!(store.records.len(), 4);
    let before = store.records.len();
    assert!(store
        .register_outputs(
            &source,
            "proof",
            vec![
                blob(),
                Blob {
                    mime_type: "application/javascript".into(),
                    bytes: vec![]
                }
            ]
        )
        .is_err());
    assert_eq!(store.records.len(), before);
    store.revoke(&source).unwrap();
    assert!(store.records.is_empty());
    assert!(store.snapshot(&foreign, "proof").is_err());
    assert!(grandchild[0]["resourceId"].is_string());
}

#[test]
fn derived_outputs_share_reserved_budget_and_expiry_with_inputs() {
    use crate::plugin_worker::resource_output::Blob;
    let mut store = Store::default();
    let source = prepared(&mut store, b"");
    store.commit(&source, "proof").unwrap();
    for _ in 1..MAX_RECORDS {
        prepared(&mut store, b"");
    }
    assert!(store
        .register_outputs(
            &source,
            "proof",
            vec![Blob {
                mime_type: "text/plain".into(),
                bytes: vec![]
            }]
        )
        .is_err());
    assert_eq!(store.records.len(), MAX_RECORDS);
    store.records.retain(|id, _| id == &source.resource_id);
    let rows = store
        .register_outputs(
            &source,
            "proof",
            vec![Blob {
                mime_type: "text/plain".into(),
                bytes: b"data".to_vec(),
            }],
        )
        .unwrap();
    assert_eq!(rows[0]["saved"], false);
    store.records.get_mut(&source.resource_id).unwrap().expires =
        Instant::now() - Duration::from_secs(1);
    store.prune();
    assert!(store.records.is_empty());
    for _ in 0..4 {
        let pending = prepared(&mut store, b"");
        store
            .records
            .get_mut(&pending.resource_id)
            .unwrap()
            .expected = MAX_RESOURCE;
    }
    let source = prepared(&mut store, b"");
    store.commit(&source, "proof").unwrap();
    assert!(store
        .register_outputs(
            &source,
            "proof",
            vec![Blob {
                mime_type: "text/plain".into(),
                bytes: vec![1]
            }]
        )
        .is_err());
    assert_eq!(store.records.len(), 5);
}
