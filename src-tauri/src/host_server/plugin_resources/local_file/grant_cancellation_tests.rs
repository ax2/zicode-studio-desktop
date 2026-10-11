use super::*;

#[test]
fn active_reads_keep_grant_budget_and_cancel_is_owner_scoped_without_replay() {
    let mut grants = Grants::default();
    let id = grants.insert(grant(Path::new("unused"))).unwrap();
    let (value, control) = grants.begin(&request(id.clone())).unwrap();
    assert_eq!(value.relative, "file");
    assert!(grants.take(&request(id.clone())).is_err());
    let mut wrong = request(id.clone());
    wrong.owner.session_id = "foreign".into();
    assert!(grants.cancel(&wrong).is_err());
    assert!(control.check().is_ok());
    // Active work must not disappear from admission/cancellation accounting.
    for _ in 0..7 {
        grants.insert(grant(Path::new("unused"))).unwrap();
    }
    assert!(grants.insert(grant(Path::new("unused"))).is_err());
    let result = grants.cancel(&request(id.clone())).unwrap();
    assert_eq!(result["cancellationRequested"], true);
    assert_eq!(result["cancelled"], false);
    assert_eq!(result["executionFinished"], false);
    assert_eq!(result["contentRead"], Value::Null);
    assert_eq!(
        control.check().unwrap_err().1 .0["error"]["code"],
        "resource_file_read_cancelled"
    );
    assert!(grants.cancel(&request(id.clone())).is_ok());
    assert_eq!(grants.1.len(), 1);
    grants.1.remove(&id); // Actual worker lease cleanup, never the cancel request.
    assert!(grants.cancel(&request(id)).is_err());
    grants.insert(grant(Path::new("unused"))).unwrap();
}
