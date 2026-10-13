//! Internal archive adapter transport. A signed native runtime is not admitted by this module.
//! The caller must own the executable, resource staging, authorization and write transaction.
use crate::{plugin_archive_events, plugin_capabilities::worker_process};
use serde_json::Value;
use std::process::{Command, Stdio};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

const MAX_REQUEST: usize = 64 * 1024;
const MAX_TIMEOUT: Duration = Duration::from_secs(15 * 60);

pub(crate) struct ArchiveExecution {
    pub receipt: plugin_archive_events::Receipt,
    pub events: Vec<Value>,
}

/// Release nothing until the owned process exits successfully and its entire trace validates.
/// This layer never trusts a path or command supplied by a plugin manifest or page.
pub(crate) fn run(
    mut command: Command,
    request: Vec<u8>,
    call_id: &str,
    operation: &str,
    timeout: Duration,
    cancelled: Option<&AtomicBool>,
) -> Result<ArchiveExecution, &'static str> {
    plugin_archive_events::ArchiveEventDecoder::new(call_id, operation)?;
    if request.len() > MAX_REQUEST {
        return Err("archive_request_too_large");
    }
    if timeout.is_zero() || timeout > MAX_TIMEOUT {
        return Err("archive_timeout_invalid");
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let (status, output) = worker_process::run_observed(
        command,
        request,
        timeout,
        plugin_archive_events::MAX_STREAM,
        cancelled,
        None,
    )
    .map_err(|error| match error.code {
        "result_too_large" => "trace_too_large",
        code => code,
    })?;
    if !status.success() {
        return Err("archive_worker_failed");
    }
    let (receipt, events) =
        plugin_archive_events::decode_trace(output.as_slice(), call_id, operation)?;
    Ok(ArchiveExecution { receipt, events })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    const CALL: &str = "archive-call-12345678-1234-4123-8123-123456789abc";

    #[cfg(windows)]
    fn reader_command(path: &str) -> Command {
        let mut command = crate::process_command::new_command("powershell.exe");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command",
                "$bytes=[System.IO.File]::ReadAllBytes($env:ZICODE_ARCHIVE_TRACE); $length=if($env:ZICODE_ARCHIVE_TRACE_MAX){[Math]::Min([int]$env:ZICODE_ARCHIVE_TRACE_MAX,$bytes.Length)}else{$bytes.Length}; [Console]::OpenStandardOutput().Write($bytes,0,$length)"])
            .env("ZICODE_ARCHIVE_TRACE", path);
        command
    }

    #[cfg(windows)]
    #[test]
    fn real_process_releases_only_a_complete_bounded_trace() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/zifile-adapter-events/list-ok.jsonl"
        );
        let result = run(
            reader_command(path),
            b"{}".to_vec(),
            CALL,
            "list",
            Duration::from_secs(10),
            None,
        )
        .unwrap();
        assert_eq!(result.receipt.status, "ok");
        assert_eq!(result.receipt.entries, 2);
        assert_eq!(result.events.len(), 5);
        let mut truncated = reader_command(path);
        truncated.env("ZICODE_ARCHIVE_TRACE_MAX", "50");
        assert_eq!(
            run(
                truncated,
                Vec::new(),
                CALL,
                "list",
                Duration::from_secs(10),
                None
            )
            .err(),
            Some("truncated_trace")
        );
        assert_eq!(
            run(
                reader_command(path),
                Vec::new(),
                "archive-call-87654321-1234-4123-8123-123456789abc",
                "list",
                Duration::from_secs(10),
                None
            )
            .err(),
            Some("call_mismatch")
        );
        assert_eq!(
            run(
                reader_command(path),
                Vec::new(),
                CALL,
                "list",
                Duration::ZERO,
                None
            )
            .err(),
            Some("archive_timeout_invalid")
        );
        let cancelled = AtomicBool::new(true);
        assert_eq!(
            run(
                reader_command(path),
                Vec::new(),
                CALL,
                "list",
                Duration::from_secs(10),
                Some(&cancelled)
            )
            .err(),
            Some("worker_cancelled")
        );
        let mut failed = crate::process_command::new_command("powershell.exe");
        failed.args(["-NoProfile", "-NonInteractive", "-Command", "exit 7"]);
        assert_eq!(
            run(
                failed,
                Vec::new(),
                CALL,
                "list",
                Duration::from_secs(10),
                None
            )
            .err(),
            Some("archive_worker_failed")
        );
        assert_eq!(
            run(
                reader_command(path),
                Vec::new(),
                CALL,
                "list",
                Duration::from_secs(10),
                None
            )
            .unwrap()
            .receipt
            .status,
            "ok"
        );
    }
}
