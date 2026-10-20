// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyArchiveAdapterEvents } from "./verify-zifile-adapter-events.mjs";

const callId = "archive-call-12345678-1234-4123-8123-123456789abc";
const fixture = readFileSync(
  new URL("../tests/fixtures/zifile-adapter-events/list-ok.jsonl", import.meta.url),
  "utf8",
);
const event = (sequence, type, payload, extra = {}) => ({
  schemaVersion: 1,
  callId,
  sequence,
  type,
  payload,
  ...extra,
});
const trace = (...events) => `${events.map((item) => JSON.stringify(item)).join("\n")}\n`;
const verify = (text, operation = "list") =>
  verifyArchiveAdapterEvents(text, { callId, operation });

describe("ZiFile adapter event draft1 conformance", () => {
  it("accepts a bounded page including a visibly unsafe archive name", () => {
    expect(verify(fixture)).toEqual({
      schemaVersion: 1,
      callId,
      operation: "list",
      status: "ok",
      entries: 2,
      progress: 0,
    });
  });

  it("accepts test, write summary, error and cancellation terminals", () => {
    for (const [operation, payload] of [
      ["test", { format: "Zip", verified: true }],
      ["extract", { format: "Zip", summary: { processedEntries: 2, outputBytes: 15 } }],
      ["create", { format: "Tar", summary: { processedEntries: 2, outputBytes: 15 } }],
      ["update", { format: "Zip", summary: { processedEntries: 2, outputBytes: 15 } }],
      ["rename", { format: "Zip", summary: { processedEntries: 2, outputBytes: 15 } }],
    ]) {
      expect(
        verify(
          trace(event(0, "started", { operation }), event(1, "result", payload), event(2, "ended", { status: "ok" })),
          operation,
        ).status,
      ).toBe("ok");
    }
    expect(
      verify(
        trace(
          event(0, "started", { operation: "list" }),
          event(1, "error", { code: "invalid_archive" }),
          event(2, "ended", { status: "error" }),
        ),
      ).status,
    ).toBe("error");
    expect(
      verify(
        trace(
          event(0, "started", { operation: "list" }),
          event(1, "cancelled", {}),
          event(2, "ended", { status: "cancelled" }),
        ),
      ).status,
    ).toBe("cancelled");
  });

  it.each([
    ["truncated_trace", fixture.trimEnd()],
    ["unsupported_version", fixture.replace('"schemaVersion":1', '"schemaVersion":2')],
    ["call_mismatch", fixture.replace(callId, "archive-call-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")],
    ["sequence_mismatch", fixture.replace('"sequence":1', '"sequence":8')],
    ["invalid_shape", fixture.replace('"sequence":1', '"sequence":1,"hostPath":"C:\\\\secret"')],
    ["invalid_json", fixture.replace('"sequence":1', '"sequence":1,"sequence":1')],
    ["invalid_json", fixture.replace('"sequence":1', String.raw`"sequence":1,"se\u0071uence":1`)],
    ["invalid_json", fixture.replace('"entryId":"entry-1"', '"entryId":"entry-1","entryId":"entry-2"')],
    ["duplicate_entry", fixture.replace('"entryId":"entry-2"', '"entryId":"entry-1"')],
    ["terminal_mismatch", fixture.replace('"status":"ok"', '"status":"error"')],
    ["invalid_format", fixture.replace('"format":"Zip"', '"format":"Unknown"')],
    ["invalid_text", fixture.replace("docs/readme.txt", "bad\\nname")],
    ["invalid_text", fixture.replace("docs/readme.txt", "bad\u0085name")],
    ["invalid_shape", fixture.replace('"nextCursor":null', '"nextCursor":null,"path":"C:\\\\secret"')],
    ["unsafe_entry_flag", fixture.replace('"name":"../unsafe.txt","kind":"file","uncompressedBytes":5,"compressedBytes":5,"safeRelativePath":false', '"name":"../unsafe.txt","kind":"file","uncompressedBytes":5,"compressedBytes":5,"safeRelativePath":true')],
    ["invalid_cursor", fixture.replace('"nextCursor":null', '"nextCursor":"C:\\\\private"')],
    ["invalid_entry_id", fixture.replace('"entryId":"entry-1"', '"entryId":"C:\\\\private"')],
    ["invalid_line_ending", fixture.replaceAll("\n", "\r\n")],
  ])("rejects %s", (code, text) => {
    expect(() => verify(text)).toThrow(code);
  });

  it("rejects an event after a terminal and unbounded pages", () => {
    const after = trace(
      event(0, "started", { operation: "list" }),
      event(1, "result", { format: "Zip", nextCursor: null }),
      event(2, "progress", { unit: "entries", completed: 1, total: 1 }),
      event(3, "ended", { status: "ok" }),
    );
    expect(() => verify(after)).toThrow("event_after_terminal");
    const entry = JSON.parse(fixture.split("\n")[1]);
    const many = [event(0, "started", { operation: "list" })];
    for (let index = 0; index < 201; index += 1) many.push(event(index + 1, "entry", { ...entry.payload, entryId: `entry-${index}` }));
    many.push(event(202, "result", { format: "Zip", nextCursor: null }), event(203, "ended", { status: "ok" }));
    expect(() => verify(trace(...many))).toThrow("entry_budget_exceeded");
  });

  it.each(["../escape", "folder\\..\\escape", "C:/private", "//server/share", "NUL.txt", "COM¹.txt", "nested/LPT².log", "CONIN$/file", `folder/${"a".repeat(256)}`, "data:stream", "trailing. "])(
    "rejects unsafeRelativePath=true for %s",
    (name) => {
      const entry = JSON.parse(fixture.split("\n")[1]);
      const text = trace(
        event(0, "started", { operation: "list" }),
        event(1, "entry", { ...entry.payload, name, safeRelativePath: true }),
        event(2, "result", { format: "Zip", nextCursor: null }),
        event(3, "ended", { status: "ok" }),
      );
      expect(() => verify(text)).toThrow("unsafe_entry_flag");
    },
  );
});
