import { expect, it } from "vitest";
import { STREAM_PROFILE, streamSelection } from "./file-digest-stream.js";

const owner = { runtimeId: "runtime", sessionId: "session",
  pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash" };
const selection = name => ({
  schemaVersion: 1,
  profile: STREAM_PROFILE,
  grantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  owner,
  contentRead: false,
  confirmed: false,
  files: [{ name, byteLength: 123 }],
  totalBytes: 123,
});

it("rejects every control character, path separator and directional override in a native file name", () => {
  const disallowed = ["\\", "/", ":"];
  for (const [first, last] of [[0, 31], [127, 159], [0x202a, 0x202e], [0x2066, 0x2069]]) {
    for (let code = first; code <= last; code++) disallowed.push(String.fromCharCode(code));
  }
  for (const character of disallowed) {
    expect(() => streamSelection(selection(`safe${character}.txt`), owner)).toThrow("resource_stream_invalid");
  }
});

it("preserves valid Unicode file names and the 255 Unicode scalar boundary", () => {
  for (const name of ["报告-🙂.json", "🙂".repeat(255)]) {
    expect(streamSelection(selection(name), owner).files).toEqual([{ name, byteLength: 123 }]);
  }
  for (const name of ["", "🙂".repeat(256)]) {
    expect(() => streamSelection(selection(name), owner)).toThrow("resource_stream_invalid");
  }
});
