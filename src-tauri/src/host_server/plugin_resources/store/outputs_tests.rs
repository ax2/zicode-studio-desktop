use super::*;

fn source(store: &mut Store) -> Access {
    let owner = Owner {
        runtime_id: "r".into(),
        session_id: "s".into(),
        plugin_id: "p".into(),
        capability_id: "c".into(),
    };
    let version = sha256_hex(b"");
    let row = store
        .prepare(
            Prepare { catalog_revision: None,
                schema_version: 1,
                owner: owner.clone(),
                mime_type: "text/plain".into(),
                byte_length: 0,
                content_version: version.clone(),
            },
            "proof".into(),
        )
        .unwrap();
    let access = Access {
        schema_version: 1,
        owner,
        resource_id: row["resourceId"].as_str().unwrap().into(),
        content_version: version,
    };
    store.commit(&access, "proof").unwrap();
    access
}
fn pending(source: &Access) -> Pending {
    Pending::prepare(
        source,
        "proof",
        vec![
            Blob {
                mime_type: "text/plain".into(),
                bytes: b"output".to_vec(),
            },
            Blob {
                mime_type: "text/plain".into(),
                bytes: vec![],
            },
        ],
    )
    .unwrap()
}

#[test]
fn cancellation_after_output_preparation_admits_no_records() {
    let mut store = Store::default();
    let source = source(&mut store);
    let pending = pending(&source);
    assert_eq!(store.records.len(), 1);
    let cancelled = AtomicBool::new(true);
    assert_eq!(
        store.publish_outputs(pending, &cancelled).unwrap_err().1 .0["error"]["code"],
        "worker_cancelled"
    );
    assert_eq!(store.records.len(), 1);
    assert_eq!(
        store
            .publish_outputs(self::pending(&source), &AtomicBool::new(false))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn source_revoke_and_expiry_after_preparation_block_publication() {
    for expire in [false, true] {
        let mut store = Store::default();
        let source = source(&mut store);
        let pending = pending(&source);
        if expire {
            store.records.get_mut(&source.resource_id).unwrap().expires =
                Instant::now() - Duration::from_secs(1);
        } else {
            store.revoke(&source).unwrap();
        }
        assert!(store
            .publish_outputs(pending, &AtomicBool::new(false))
            .is_err());
        assert!(store.records.is_empty());
    }
}

#[test]
fn quota_change_after_preparation_rejects_the_whole_output_group() {
    let mut store = Store::default();
    let source = source(&mut store);
    let pending = pending(&source);
    for _ in 1..MAX_RECORDS {
        self::source(&mut store);
    }
    assert_eq!(
        store
            .publish_outputs(pending, &AtomicBool::new(false))
            .unwrap_err()
            .1
             .0["error"]["code"],
        "resource_budget_exceeded"
    );
    assert_eq!(store.records.len(), MAX_RECORDS);
}
