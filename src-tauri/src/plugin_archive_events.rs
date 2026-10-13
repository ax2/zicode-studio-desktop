//! Incremental, bounded receiver for the proposed ZiFile adapter event stream.
//! Native execution is not admitted yet; this decoder grants no resource access.
use serde_json::Value;
use std::collections::HashSet;
use std::io::Read;

pub(crate) const MAX_STREAM: usize = 512 * 1024;
const MAX_LINE: usize = 16 * 1024;
const MAX_EVENTS: usize = 1304;
const MAX_ENTRIES: usize = 200;
const MAX_PROGRESS: usize = 1000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const FORMATS: &[&str] = &[
    "Zip",
    "SevenZip",
    "Tar",
    "TarGzip",
    "TarZstd",
    "TarXz",
    "TarLzma",
    "TarBzip2",
    "TarLz4",
    "Gzip",
    "Zstandard",
    "Xz",
    "Lzma",
    "Bzip2",
    "Lz4",
    "Brotli",
    "Rar",
    "Cab",
];
const ERROR_CODES: &[&str] = &[
    "unsupported_format",
    "invalid_archive",
    "password_required",
    "bad_password",
    "resource_changed",
    "permission_denied",
    "budget_exceeded",
    "worker_failed",
    "io_failed",
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Receipt {
    pub call_id: String,
    pub operation: String,
    pub status: &'static str,
    pub entries: usize,
    pub progress: usize,
}

pub(crate) struct ArchiveEventDecoder {
    call_id: String,
    operation: String,
    bytes: usize,
    sequence: usize,
    entries: usize,
    progress: usize,
    entry_ids: HashSet<String>,
    terminal: Option<&'static str>,
    ended: bool,
    failed: bool,
}

impl ArchiveEventDecoder {
    pub(crate) fn new(call_id: &str, operation: &str) -> Result<Self, &'static str> {
        let Some(uuid) = call_id.strip_prefix("archive-call-") else {
            return Err("invalid_expectation");
        };
        let parsed = uuid::Uuid::parse_str(uuid).map_err(|_| "invalid_expectation")?;
        if parsed.get_version_num() != 4
            || parsed.get_variant() != uuid::Variant::RFC4122
            || parsed.hyphenated().to_string() != uuid
            || !matches!(
                operation,
                "list" | "test" | "create" | "extract" | "update" | "rename"
            )
        {
            return Err("invalid_expectation");
        }
        Ok(Self {
            call_id: call_id.into(),
            operation: operation.into(),
            bytes: 0,
            sequence: 0,
            entries: 0,
            progress: 0,
            entry_ids: HashSet::new(),
            terminal: None,
            ended: false,
            failed: false,
        })
    }

    /// Accept exactly one LF-terminated line. The returned event is safe to use only after
    /// the caller has also checked resource identity, worker lifecycle and transaction state.
    pub(crate) fn accept_line(&mut self, line: &[u8]) -> Result<Value, &'static str> {
        if self.failed {
            return Err("decoder_failed");
        }
        let result = self.accept_line_inner(line);
        if result.is_err() {
            self.failed = true
        }
        result
    }

    fn accept_line_inner(&mut self, line: &[u8]) -> Result<Value, &'static str> {
        if self.ended {
            return Err("event_after_end");
        }
        self.bytes = self
            .bytes
            .checked_add(line.len())
            .filter(|n| *n <= MAX_STREAM)
            .ok_or("trace_too_large")?;
        if self.sequence >= MAX_EVENTS {
            return Err("event_budget_exceeded");
        }
        if line.len() < 2 || line.len() - 1 > MAX_LINE || line.last() != Some(&b'\n') {
            return Err("event_size_exceeded");
        }
        if line.contains(&b'\r') {
            return Err("invalid_line_ending");
        }
        if line[..line.len() - 1].contains(&b'\n') {
            return Err("invalid_line_ending");
        }
        let event: Value = serde_json::from_slice(line).map_err(|_| "invalid_json")?;
        fields(
            &event,
            &["schemaVersion", "callId", "sequence", "type", "payload"],
        )?;
        if event["schemaVersion"] != 1 {
            return Err("unsupported_version");
        }
        if event["callId"] != self.call_id {
            return Err("call_mismatch");
        }
        if event["sequence"].as_u64() != Some(self.sequence as u64) {
            return Err("sequence_mismatch");
        }
        let kind = event["type"].as_str().ok_or("unknown_event")?;
        if self.sequence == 0 && kind != "started" {
            return Err("missing_start");
        }
        if self.sequence > 0 && kind == "started" {
            return Err("duplicate_start");
        }
        if self.terminal.is_some() && kind != "ended" {
            return Err("event_after_terminal");
        }
        let payload = &event["payload"];
        match kind {
            "started" => {
                fields(payload, &["operation"])?;
                if payload["operation"] != self.operation {
                    return Err("operation_mismatch");
                }
            }
            "entry" => {
                if self.operation != "list" {
                    return Err("unexpected_entry");
                }
                fields(
                    payload,
                    &[
                        "entryId",
                        "name",
                        "kind",
                        "uncompressedBytes",
                        "compressedBytes",
                        "safeRelativePath",
                    ],
                )?;
                let id = bounded_text(&payload["entryId"], 128)?;
                if !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
                {
                    return Err("invalid_entry_id");
                }
                let name = bounded_text(&payload["name"], 1024)?;
                if !matches!(payload["kind"].as_str(), Some("file" | "directory"))
                    || !payload["safeRelativePath"].is_boolean()
                {
                    return Err("invalid_entry");
                }
                if payload["safeRelativePath"] == true && !safe_relative_path(name) {
                    return Err("unsafe_entry_flag");
                }
                count(&payload["uncompressedBytes"])?;
                count(&payload["compressedBytes"])?;
                if !self.entry_ids.insert(id.into()) {
                    return Err("duplicate_entry");
                }
                self.entries += 1;
                if self.entries > MAX_ENTRIES {
                    return Err("entry_budget_exceeded");
                }
            }
            "progress" => {
                fields(payload, &["unit", "completed", "total"])?;
                if !matches!(payload["unit"].as_str(), Some("entries" | "bytes")) {
                    return Err("invalid_progress");
                }
                let completed = count(&payload["completed"])?;
                if !payload["total"].is_null() && completed > count(&payload["total"])? {
                    return Err("invalid_progress");
                }
                self.progress += 1;
                if self.progress > MAX_PROGRESS {
                    return Err("progress_budget_exceeded");
                }
            }
            "result" => {
                match self.operation.as_str() {
                    "list" => {
                        fields(payload, &["format", "nextCursor"])?;
                        if !payload["nextCursor"].is_null() {
                            let cursor = payload["nextCursor"].as_str().ok_or("invalid_cursor")?;
                            if !(16..=512).contains(&cursor.len()) || !cursor.bytes().all(base64url)
                            {
                                return Err("invalid_cursor");
                            }
                        }
                    }
                    "test" => {
                        fields(payload, &["format", "verified"])?;
                        if payload["verified"] != true {
                            return Err("invalid_result");
                        }
                    }
                    _ => {
                        fields(payload, &["format", "summary"])?;
                        fields(&payload["summary"], &["processedEntries", "outputBytes"])?;
                        count(&payload["summary"]["processedEntries"])?;
                        count(&payload["summary"]["outputBytes"])?;
                    }
                }
                if !payload["format"]
                    .as_str()
                    .is_some_and(|f| FORMATS.contains(&f))
                {
                    return Err("invalid_format");
                }
                self.terminal = Some("ok");
            }
            "error" => {
                fields(payload, &["code"])?;
                if !payload["code"]
                    .as_str()
                    .is_some_and(|c| ERROR_CODES.contains(&c))
                {
                    return Err("invalid_error_code");
                }
                self.terminal = Some("error");
            }
            "cancelled" => {
                fields(payload, &[])?;
                self.terminal = Some("cancelled")
            }
            "ended" => {
                fields(payload, &["status"])?;
                if self.terminal.is_none() || self.terminal != payload["status"].as_str() {
                    return Err("terminal_mismatch");
                }
                self.ended = true;
            }
            _ => return Err("unknown_event"),
        }
        self.sequence += 1;
        Ok(event)
    }

    pub(crate) fn finish(self) -> Result<Receipt, &'static str> {
        if self.failed || !self.ended || self.sequence < 3 {
            return Err("truncated_trace");
        }
        Ok(Receipt {
            call_id: self.call_id,
            operation: self.operation,
            status: self.terminal.ok_or("terminal_mismatch")?,
            entries: self.entries,
            progress: self.progress,
        })
    }
}

/// Collect a complete bounded stream before exposing events to a caller. This prevents
/// a truncated or rejected trace from appearing as a successful partial result.
pub(crate) fn decode_trace(
    reader: impl Read,
    call_id: &str,
    operation: &str,
) -> Result<(Receipt, Vec<Value>), &'static str> {
    let mut decoder = ArchiveEventDecoder::new(call_id, operation)?;
    let mut bytes = Vec::new();
    reader
        .take((MAX_STREAM + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "trace_unavailable")?;
    if bytes.len() > MAX_STREAM {
        return Err("trace_too_large");
    }
    if bytes.last() != Some(&b'\n') {
        return Err("truncated_trace");
    }
    let mut events = Vec::new();
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        events.push(decoder.accept_line(line)?);
    }
    Ok((decoder.finish()?, events))
}

fn fields(value: &Value, expected: &[&str]) -> Result<(), &'static str> {
    let object = value.as_object().ok_or("invalid_shape")?;
    if object.len() != expected.len() || !expected.iter().all(|key| object.contains_key(*key)) {
        return Err("invalid_shape");
    }
    Ok(())
}

fn count(value: &Value) -> Result<u64, &'static str> {
    value
        .as_u64()
        .filter(|n| *n <= MAX_SAFE_INTEGER)
        .ok_or("invalid_number")
}

fn bounded_text(value: &Value, max: usize) -> Result<&str, &'static str> {
    let text = value
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= max)
        .ok_or("invalid_text")?;
    if text.chars().any(char::is_control) {
        return Err("invalid_text");
    }
    Ok(text)
}

fn base64url(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

fn safe_relative_path(name: &str) -> bool {
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') {
        return false;
    }
    normalized.split('/').all(|part| {
        if part.is_empty()
            || matches!(part, "." | "..")
            || part.bytes().any(|b| b"<>:\"|?*".contains(&b))
            || part.ends_with(['.', ' '])
        {
            return false;
        }
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        !matches!(
            base.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        )
    })
}

#[cfg(test)]
#[path = "plugin_archive_events_tests.rs"]
mod tests;
