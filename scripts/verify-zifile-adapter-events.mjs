/** Provider-facing verifier for the proposed ZiFile archive event envelope.
 * This is a conformance gate, not a native plugin execution path. */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OPERATIONS = new Set(["list", "test", "create", "extract", "update", "rename"]);
const FORMATS = new Set([
  "Zip", "SevenZip", "Tar", "TarGzip", "TarZstd", "TarXz", "TarLzma", "TarBzip2",
  "TarLz4", "Gzip", "Zstandard", "Xz", "Lzma", "Bzip2", "Lz4", "Brotli", "Rar", "Cab",
]);
const ERROR_CODES = new Set([
  "unsupported_format", "invalid_archive", "password_required", "bad_password",
  "resource_changed", "permission_denied", "budget_exceeded", "worker_failed", "io_failed",
]);
const MAX_BYTES = 512 * 1024;
const MAX_LINE_BYTES = 16 * 1024;
const MAX_EVENTS = 1304;
const MAX_ENTRIES = 200;
const MAX_PROGRESS = 1000;
const CALL_ID = /^archive-call-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RESERVED_PATH_PARTS = new Set(["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"]);
const RESERVED_SERIAL_PORT = /^(?:COM|LPT)[1-9¹²³]$/u;

function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function object(value, fields) {
  if (value === null || Array.isArray(value) || typeof value !== "object") reject("invalid_shape");
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    reject("invalid_shape");
  }
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) reject("invalid_number");
}

function boundedText(value, maximum) {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > maximum) {
    reject("invalid_text");
  }
  for (const character of value) {
    if (/\p{Cc}/u.test(character)) reject("invalid_text");
  }
}

function safeRelativePath(name) {
  const normalized = name.replaceAll("\\", "/");
  return !normalized.startsWith("/")
    && normalized.split("/").every((part) => {
      if (!part || Buffer.byteLength(part, "utf8") > 255 || part === "." || part === ".." || /[<>:"|?*]/u.test(part) || /[. ]$/u.test(part)) return false;
      const base = part.split(".")[0].toUpperCase();
      return !RESERVED_PATH_PARTS.has(base) && !RESERVED_SERIAL_PORT.test(base);
    });
}

function validatePayload(event, operation, seenIds) {
  const payload = event.payload;
  switch (event.type) {
    case "started":
      object(payload, ["operation"]);
      if (payload.operation !== operation) reject("operation_mismatch");
      break;
    case "entry":
      if (operation !== "list") reject("unexpected_entry");
      object(payload, ["entryId", "name", "kind", "uncompressedBytes", "compressedBytes", "safeRelativePath"]);
      boundedText(payload.entryId, 128);
      if (!/^[A-Za-z0-9_-]+$/u.test(payload.entryId)) reject("invalid_entry_id");
      boundedText(payload.name, 1024);
      if (!new Set(["file", "directory"]).has(payload.kind) || typeof payload.safeRelativePath !== "boolean") reject("invalid_entry");
      if (payload.safeRelativePath && !safeRelativePath(payload.name)) reject("unsafe_entry_flag");
      count(payload.uncompressedBytes);
      count(payload.compressedBytes);
      if (seenIds.has(payload.entryId)) reject("duplicate_entry");
      seenIds.add(payload.entryId);
      break;
    case "progress":
      object(payload, ["unit", "completed", "total"]);
      if (!new Set(["entries", "bytes"]).has(payload.unit)) reject("invalid_progress");
      count(payload.completed);
      if (payload.total !== null) {
        count(payload.total);
        if (payload.completed > payload.total) reject("invalid_progress");
      }
      break;
    case "result":
      if (operation === "list") {
        object(payload, ["format", "nextCursor"]);
        if (payload.nextCursor !== null && (typeof payload.nextCursor !== "string" || !/^[A-Za-z0-9_-]{16,512}$/u.test(payload.nextCursor))) reject("invalid_cursor");
      } else if (operation === "test") {
        object(payload, ["format", "verified"]);
        if (payload.verified !== true) reject("invalid_result");
      } else {
        object(payload, ["format", "summary"]);
        object(payload.summary, ["processedEntries", "outputBytes"]);
        count(payload.summary.processedEntries);
        count(payload.summary.outputBytes);
      }
      if (!FORMATS.has(payload.format)) reject("invalid_format");
      break;
    case "error":
      object(payload, ["code"]);
      if (!ERROR_CODES.has(payload.code)) reject("invalid_error_code");
      break;
    case "cancelled":
      object(payload, []);
      break;
    case "ended":
      object(payload, ["status"]);
      if (!new Set(["ok", "error", "cancelled"]).has(payload.status)) reject("invalid_end");
      break;
    default:
      reject("unknown_event");
  }
}

export function verifyArchiveAdapterEvents(trace, { callId, operation }) {
  if (!CALL_ID.test(callId) || !OPERATIONS.has(operation)) reject("invalid_expectation");
  if (typeof trace !== "string" || Buffer.byteLength(trace, "utf8") > MAX_BYTES) reject("trace_too_large");
  if (trace.includes("\r")) reject("invalid_line_ending");
  if (!trace.endsWith("\n")) reject("truncated_trace");
  const lines = trace.slice(0, -1).split("\n");
  if (lines.length < 3 || lines.length > MAX_EVENTS) reject("event_budget_exceeded");
  const seenIds = new Set();
  let terminal = null;
  let entries = 0;
  let progress = 0;
  for (const [sequence, line] of lines.entries()) {
    if (!line || Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) reject("event_size_exceeded");
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      reject("invalid_json");
    }
    object(event, ["schemaVersion", "callId", "sequence", "type", "payload"]);
    if (event.schemaVersion !== 1) reject("unsupported_version");
    if (event.callId !== callId) reject("call_mismatch");
    if (event.sequence !== sequence) reject("sequence_mismatch");
    if (sequence === 0 && event.type !== "started") reject("missing_start");
    if (sequence > 0 && event.type === "started") reject("duplicate_start");
    if (terminal && event.type !== "ended") reject("event_after_terminal");
    if (event.type === "ended" && sequence !== lines.length - 1) reject("event_after_end");
    validatePayload(event, operation, seenIds);
    if (event.type === "entry" && ++entries > MAX_ENTRIES) reject("entry_budget_exceeded");
    if (event.type === "progress" && ++progress > MAX_PROGRESS) reject("progress_budget_exceeded");
    if (["result", "error", "cancelled"].includes(event.type)) terminal = event.type;
    if (event.type === "ended") {
      if (!terminal || event.payload.status !== (terminal === "result" ? "ok" : terminal)) reject("terminal_mismatch");
    }
  }
  if (lines.at(-1) === undefined || JSON.parse(lines.at(-1)).type !== "ended") reject("missing_end");
  return { schemaVersion: 1, callId, operation, status: terminal === "result" ? "ok" : terminal, entries, progress };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file, operation, callId] = process.argv.slice(2);
  try {
    if (!file || !operation || !callId || process.argv.length !== 5) reject("usage: <trace.jsonl> <operation> <callId>");
    if (statSync(file).size > MAX_BYTES) reject("trace_too_large");
    let trace;
    try {
      trace = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
    } catch {
      reject("trace_unavailable_or_invalid_utf8");
    }
    const result = verifyArchiveAdapterEvents(trace, { callId, operation });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.code ?? "trace_unavailable"}\n`);
    process.exitCode = 1;
  }
}
