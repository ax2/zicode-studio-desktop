use super::*;

fn owner() -> Owner {
    Owner {
        runtime_id: "runtime".into(),
        session_id: "session".into(),
        plugin_id: "plugin".into(),
        capability_id: "tool".into(),
    }
}
fn grant() -> Grant {
    Grant {
        owner: owner(),
        proof: "proof".into(),
        root: PathBuf::from("must-not-be-opened"),
        relative: "private-path".into(),
        stamp: "stamp".into(),
        expires: Instant::now() + TTL,
    }
}
fn request(id: String) -> FileGrant {
    FileGrant {
        schema_version: 1,
        owner: owner(),
        grant_id: id,
        confirmed: true,
    }
}

#[test]
fn status_tracks_real_finish_and_never_turns_cancel_into_completion() {
    let mut grants = Grants::default();
    let id = grants.insert(grant()).unwrap();
    let request = request(id.clone());
    let prepared = grants.status(&request).unwrap();
    assert_eq!(prepared["phase"], "prepared");
    assert_eq!(prepared["contentRead"], false);
    let (_, control) = grants.begin(&request).unwrap();
    assert_eq!(grants.status(&request).unwrap()["phase"], "reading");
    grants.cancel(&request).unwrap();
    let reading = grants.status(&request).unwrap();
    assert_eq!(reading["cancellationRequested"], true);
    assert_eq!(reading["executionFinished"], false);
    assert_eq!(reading["contentRead"], Value::Null);
    assert_eq!(
        control.check().unwrap_err().1 .0["error"]["code"],
        "resource_file_read_cancelled"
    );
    grants.finish(&id);
    let ended = grants.status(&request).unwrap();
    assert_eq!(ended["phase"], "ended");
    assert_eq!(ended["executionFinished"], true);
    assert_eq!(ended["outcome"], "cancelled");
    assert!(grants.take(&request).is_err());
    assert!(!ended.to_string().contains("private-path"));
    assert!(!ended.to_string().contains("proof"));
    assert!(ended.get("access").is_none());
    assert!(ended.get("resourceId").is_none());
    let mut wrong = request;
    wrong.owner.capability_id = "another-tool".into();
    assert!(grants.status(&wrong).is_err());
}

#[test]
fn pending_cancel_published_failure_and_timeout_have_distinct_receipts() {
    for expected in ["cancelled", "published", "failed", "timedOut"] {
        let mut grants = Grants::default();
        let id = grants.insert(grant()).unwrap();
        let request = request(id.clone());
        if expected == "cancelled" {
            grants.cancel(&request).unwrap();
        } else {
            let (_, control) = grants.begin(&request).unwrap();
            if expected == "published" {
                control.published();
            }
            if expected == "timedOut" {
                let expired = Arc::new(reading::Control::new(Instant::now()));
                grants.1.get_mut(&id).unwrap().control = expired.clone();
                assert_eq!(
                    expired.check().unwrap_err().1 .0["error"]["code"],
                    "resource_file_read_timeout"
                );
            }
            grants.finish(&id);
        }
        let result = grants.status(&request).unwrap();
        assert_eq!(result["outcome"], expected);
        assert_eq!(
            result["contentRead"],
            match expected {
                "cancelled" => json!(false),
                "published" => json!(true),
                _ => Value::Null,
            }
        );
        assert!(grants.begin(&request).is_err());
    }
}

#[test]
fn receipts_are_bounded_expiring_and_do_not_evict_live_work() {
    let mut grants = Grants::default();
    let id = grants.insert(grant()).unwrap();
    grants.begin(&request(id.clone())).unwrap();
    for n in 0..=MAX_RECEIPTS {
        grants
            .2
            .record(format!("receipt-{n}"), owner(), "failed", None);
    }
    assert_eq!(grants.2 .0.len(), MAX_RECEIPTS);
    assert!(!grants.2 .0.contains_key("receipt-0"));
    assert_eq!(
        grants.status(&request(id.clone())).unwrap()["phase"],
        "reading"
    );
    let expired = request("receipt-1".into());
    grants.2 .0.get_mut(&expired.grant_id).unwrap().expires = Instant::now();
    assert!(grants.status(&expired).is_err());
    assert_eq!(grants.1.len(), 1);
    // A fresh Host has no proof about an old request, even with the same owner.
    assert!(Grants::default().status(&request(id)).is_err());
}
