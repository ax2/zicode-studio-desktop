use super::*;
use serde_json::json;

const CALL: &str = "archive-call-12345678-1234-4123-8123-123456789abc";

fn line(sequence: usize, kind: &str, payload: Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(&json!({
        "schemaVersion":1,"callId":CALL,"sequence":sequence,"type":kind,"payload":payload
    }))
    .unwrap();
    bytes.push(b'\n');
    bytes
}

#[test]
fn rejects_duplicate_event_keys_before_accepting_any_result() {
    let mut decoder = ArchiveEventDecoder::new(CALL, "list").unwrap();
    let mut duplicate = format!(
        r#"{{"schemaVersion":1,"callId":"{CALL}","sequence":0,"type":"started","payload":{{"operation":"list","operation":"test"}}}}"#
    )
    .into_bytes();
    duplicate.push(b'\n');
    assert_eq!(decoder.accept_line(&duplicate), Err("invalid_json"));
    assert_eq!(
        decoder.accept_line(&line(0, "started", json!({"operation":"list"}))),
        Err("decoder_failed")
    );
}

#[test]
fn accepts_bounded_list_and_failure_terminal() {
    let mut decoder = ArchiveEventDecoder::new(CALL, "list").unwrap();
    decoder
        .accept_line(&line(0, "started", json!({"operation":"list"})))
        .unwrap();
    decoder
        .accept_line(&line(
            1,
            "entry",
            json!({"entryId":"one","name":"../bad",
        "kind":"file","uncompressedBytes":7,"compressedBytes":4,"safeRelativePath":false}),
        ))
        .unwrap();
    decoder
        .accept_line(&line(
            2,
            "progress",
            json!({"unit":"entries","completed":1,"total":1}),
        ))
        .unwrap();
    decoder
        .accept_line(&line(
            3,
            "result",
            json!({"format":"Zip","nextCursor":null}),
        ))
        .unwrap();
    decoder
        .accept_line(&line(4, "ended", json!({"status":"ok"})))
        .unwrap();
    assert_eq!(
        decoder.finish().unwrap(),
        Receipt {
            call_id: CALL.into(),
            operation: "list".into(),
            status: "ok",
            entries: 1,
            progress: 1
        }
    );

    let mut decoder = ArchiveEventDecoder::new(CALL, "test").unwrap();
    decoder
        .accept_line(&line(0, "started", json!({"operation":"test"})))
        .unwrap();
    decoder
        .accept_line(&line(1, "error", json!({"code":"bad_password"})))
        .unwrap();
    decoder
        .accept_line(&line(2, "ended", json!({"status":"error"})))
        .unwrap();
    assert_eq!(decoder.finish().unwrap().status, "error");
}

#[test]
fn shared_provider_vector_is_checked_before_any_event_is_returned() {
    let trace = include_bytes!("../../tests/fixtures/zifile-adapter-events/list-ok.jsonl");
    let (receipt, events) = decode_trace(trace.as_slice(), CALL, "list").unwrap();
    assert_eq!(receipt.entries, 2);
    assert_eq!(receipt.status, "ok");
    assert_eq!(events.len(), 5);
    assert_eq!(
        decode_trace(&trace[..trace.len() - 1], CALL, "list"),
        Err("truncated_trace")
    );
}

#[test]
fn rejects_untrusted_event_shapes_and_poisoned_stream() {
    assert!(ArchiveEventDecoder::new("archive-call-123", "list").is_err());
    let mut decoder = ArchiveEventDecoder::new(CALL, "list").unwrap();
    decoder
        .accept_line(&line(0, "started", json!({"operation":"list"})))
        .unwrap();
    assert_eq!(
        decoder.accept_line(&line(
            1,
            "entry",
            json!({"entryId":"one","name":"../bad",
        "kind":"file","uncompressedBytes":7,"compressedBytes":4,"safeRelativePath":true})
        )),
        Err("unsafe_entry_flag")
    );
    assert_eq!(
        decoder.accept_line(&line(1, "error", json!({"code":"io_failed"}))),
        Err("decoder_failed")
    );
    assert!(decoder.finish().is_err());

    let mut decoder = ArchiveEventDecoder::new(CALL, "list").unwrap();
    decoder
        .accept_line(&line(0, "started", json!({"operation":"list"})))
        .unwrap();
    assert_eq!(
        decoder.accept_line(&line(1, "ended", json!({"status":null}))),
        Err("terminal_mismatch")
    );
}

#[test]
fn windows_device_names_cannot_be_flagged_safe_for_extraction() {
    let long_name = "a".repeat(256);
    for name in ["COM¹.txt", "nested/LPT².log", "CONIN$/file", "NUL.tar.gz"]
        .into_iter()
        .chain(std::iter::once(long_name.as_str()))
    {
        let mut decoder = ArchiveEventDecoder::new(CALL, "list").unwrap();
        decoder
            .accept_line(&line(0, "started", json!({"operation":"list"})))
            .unwrap();
        let entry = |safe| line(1, "entry", json!({"entryId":"one","name":name,
            "kind":"file","uncompressedBytes":1,"compressedBytes":1,
            "safeRelativePath":safe}));
        assert_eq!(decoder.accept_line(&entry(true)), Err("unsafe_entry_flag"), "{name}");

        let mut display = ArchiveEventDecoder::new(CALL, "list").unwrap();
        display.accept_line(&line(0, "started", json!({"operation":"list"}))).unwrap();
        assert!(display.accept_line(&entry(false)).is_ok(), "{name}");
    }
}

#[test]
fn rejects_serialization_and_budget_violations() {
    let mut decoder = ArchiveEventDecoder::new(CALL, "test").unwrap();
    let mut first = line(0, "started", json!({"operation":"test"}));
    first.insert(1, b'\n');
    assert_eq!(decoder.accept_line(&first), Err("invalid_line_ending"));

    let mut decoder = ArchiveEventDecoder::new(CALL, "test").unwrap();
    decoder
        .accept_line(&line(0, "started", json!({"operation":"test"})))
        .unwrap();
    for sequence in 1..=MAX_PROGRESS {
        decoder
            .accept_line(&line(
                sequence,
                "progress",
                json!({"unit":"bytes",
            "completed":sequence,"total":null}),
            ))
            .unwrap();
    }
    assert_eq!(
        decoder.accept_line(&line(
            MAX_PROGRESS + 1,
            "progress",
            json!({"unit":"bytes",
        "completed":1,"total":null})
        )),
        Err("progress_budget_exceeded")
    );
}
