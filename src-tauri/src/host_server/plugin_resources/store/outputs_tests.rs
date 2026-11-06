use super::*;

#[test]
fn host_metadata_report_is_atomic_bounded_and_revoked_with_its_source() {
    let mut store=Store::default();let source=source(&mut store);
    let mut pending=Pending::prepare_with_profile(std::slice::from_ref(&source),"proof",vec![Blob{mime_type:"image/png".into(),bytes:vec![1]}],Profile::ImageMetadata2).unwrap();
    let report=json!({"schemaVersion":2,"material":"image-metadata-report","notes":"no original metadata values"});
    pending.attach_metadata_report(&report).unwrap();
    assert!(pending.attach_metadata_report(&report).is_err());
    let (images,descriptor)=store.publish_outputs_with_report(pending,&AtomicBool::new(false)).unwrap();
    assert_eq!(images.as_array().unwrap().len(),1);
    let descriptor=descriptor.unwrap();assert_eq!(descriptor["mimeType"],"application/json");assert_eq!(descriptor["origin"],"host-report");
    let access=Access{schema_version:1,owner:source.owner.clone(),resource_id:descriptor["resourceId"].as_str().unwrap().into(),content_version:descriptor["contentVersion"].as_str().unwrap().into()};
    let saved=store.prepare_save(&access,"proof","destination".into(),std::path::PathBuf::from("fixture"),"workspace","0.1.0").unwrap();
    assert!(saved["preview"]["relativePath"].as_str().unwrap().ends_with("/result.json"));
    assert_eq!(serde_json::from_slice::<Value>(&store.snapshot(&access,"proof").unwrap().bytes).unwrap(),report);
    assert!(!Profile::Draft1.permits_mime("application/json")); // host-only, never a guest type
    store.revoke(&source).unwrap();assert!(store.snapshot(&access,"proof").is_err());
    let mut pending=Pending::prepare_with_profile(std::slice::from_ref(&source),"proof",vec![Blob{mime_type:"image/png".into(),bytes:vec![1]}],Profile::ImageMetadata2).unwrap();
    assert!(pending.attach_metadata_report(&json!("x".repeat(48*1024))).is_err());
}

#[test]
fn host_metadata_report_never_blocks_existing_image_output_when_draft_pool_is_full() {
    let mut store = Store::default(); let source = source(&mut store);
    for _ in 0..4 {
        store.prepare(Prepare { schema_version:1, owner:source.owner.clone(), mime_type:"text/plain".into(),
            byte_length:32*1024*1024, content_version:sha256_hex(b"unused"), catalog_revision:None }, "proof".into()).unwrap();
    }
    let mut pending=Pending::prepare_with_profile(std::slice::from_ref(&source),"proof",vec![Blob{mime_type:"image/png".into(),bytes:vec![1]}],Profile::ImageMetadata2).unwrap();
    pending.attach_metadata_report(&json!({"schemaVersion":2})).unwrap();
    let (images,report)=store.publish_outputs_with_report(pending,&AtomicBool::new(false)).unwrap();
    assert_eq!(images.as_array().unwrap().len(),1);assert!(report.is_none());
}

#[test]
fn metadata_reservations_do_not_enlarge_legacy_budget_or_block_its_separate_reservation(){
    let mut store=Store::default();let source=source(&mut store);
    let pending=Pending::prepare_with_profile(std::slice::from_ref(&source),"proof",vec![Blob{mime_type:"image/png".into(),bytes:vec![1]}],Profile::ImageMetadata2).unwrap();
    let output=store.publish_outputs(pending,&AtomicBool::new(false)).unwrap();let id=output[0]["resourceId"].as_str().unwrap();
    // Budget arithmetic fixture only; it does not claim these bytes are a decoded image.
    store.records.get_mut(id).unwrap().expected=128*1024*1024;
    for _ in 0..4 {
        assert!(store.prepare(Prepare{schema_version:1,owner:source.owner.clone(),mime_type:"image/png".into(),byte_length:32*1024*1024,content_version:source.content_version.clone(),catalog_revision:None},"proof".into()).is_ok());
    }
    assert!(store.prepare(Prepare{schema_version:1,owner:source.owner.clone(),mime_type:"image/png".into(),byte_length:1,content_version:source.content_version.clone(),catalog_revision:None},"proof".into()).is_err());
    store.revoke(&source).unwrap();assert_eq!(store.records.len(),4);
}

#[test]
fn metadata_derived_receipt_is_typed_and_cancellation_keeps_the_prior_records(){
    let mut store=Store::default();let source=source(&mut store);
    let pending=Pending::prepare_with_profile(std::slice::from_ref(&source),"proof",vec![Blob{mime_type:"image/png".into(),bytes:vec![1]}],Profile::ImageMetadata2).unwrap();
    let descriptors=store.publish_outputs(pending,&AtomicBool::new(false)).unwrap();
    let access=Access{schema_version:1,owner:source.owner.clone(),resource_id:descriptors[0]["resourceId"].as_str().unwrap().into(),content_version:descriptors[0]["contentVersion"].as_str().unwrap().into()};
    let receipt=store.prepare_save(&access,"proof","destination".into(),std::path::PathBuf::from("fixture"),"workspace","0.1.0").unwrap();
    assert_eq!(receipt["preview"]["profile"],Profile::METADATA_SAVE);
    let count=store.records.len();
    let pending=Pending::prepare_with_profile(std::slice::from_ref(&source),"proof",vec![Blob{mime_type:"image/png".into(),bytes:vec![2]}],Profile::ImageMetadata2).unwrap();
    assert!(store.publish_outputs(pending,&AtomicBool::new(true)).is_err());assert_eq!(store.records.len(),count);
    assert_eq!(store.snapshot(&access,"proof").unwrap().bytes,vec![1]);
}

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
            Prepare {
                catalog_revision: None,
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
        std::slice::from_ref(source),
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

#[test]
fn every_source_controls_a_derived_resource() {
    for revoke_second in [false, true] {
        let mut store = Store::default();
        let first = source(&mut store);
        let second = source(&mut store);
        let sources = [first.clone(), second.clone()];
        let output = Pending::prepare(
            &sources,
            "proof",
            vec![Blob {
                mime_type: "text/plain".into(),
                bytes: b"combined".to_vec(),
            }],
        )
        .unwrap();
        let descriptors = store
            .publish_outputs(output, &AtomicBool::new(false))
            .unwrap();
        assert_eq!(
            descriptors[0]["derivedFromAll"].as_array().unwrap().len(),
            2
        );
        let derived = Access {
            schema_version: 1,
            owner: first.owner.clone(),
            resource_id: descriptors[0]["resourceId"].as_str().unwrap().into(),
            content_version: descriptors[0]["contentVersion"].as_str().unwrap().into(),
        };
        assert_eq!(store.lineage(&derived, "proof").unwrap().len(), 2);
        store
            .revoke(if revoke_second { &second } else { &first })
            .unwrap();
        assert!(store.check(&derived, "proof").is_err());
        assert_eq!(store.record_count(), 1);
    }
}

#[test]
fn missing_source_blocks_group_publication() {
    for expire_second in [false, true] {
        let mut store = Store::default();
        let first = source(&mut store);
        let second = source(&mut store);
        let pending = Pending::prepare(
            &[first.clone(), second.clone()],
            "proof",
            vec![Blob {
                mime_type: "text/plain".into(),
                bytes: b"combined".to_vec(),
            }],
        )
        .unwrap();
        if expire_second {
            store.records.get_mut(&second.resource_id).unwrap().expires =
                Instant::now() - Duration::from_secs(1);
        } else {
            store.revoke(&first).unwrap();
        }
        assert!(store
            .publish_outputs(pending, &AtomicBool::new(false))
            .is_err());
        assert_eq!(store.record_count(), 1);
    }
}

#[test]
fn repeated_or_empty_sources_are_rejected() {
    let mut store = Store::default();
    let first = source(&mut store);
    assert!(Pending::prepare(&[], "proof", vec![]).is_err());
    assert!(Pending::prepare(&[first.clone(), first], "proof", vec![]).is_err());
}
