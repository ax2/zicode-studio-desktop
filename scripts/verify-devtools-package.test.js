// @vitest-environment node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { verifyDevtoolsPackage } from "./verify-devtools-package.mjs";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const scratch = resolve(".cache/task-scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "package-receipt-test-"));
  roots.push(root);
  writeFileSync(
    join(root, "OWNER.md"),
    "Synthetic package receipt tests; ephemeral, no user data.",
  );
  const directory = join(root, "plugin");
  mkdirSync(directory);
  const bytes = Buffer.from("synthetic guest bytes");
  writeFileSync(join(directory, "tools.wasm"), bytes);
  const files = [
    {
      path: "tools.wasm",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  ];
  const index = join(root, "verification.json");
  const save = () => writeFileSync(index, JSON.stringify({ files }));
  save();
  return { root, directory, index, files, save };
}

it("hashes the exact file inventory without copying, executing or claiming acceptance", async () => {
  const f = fixture();
  const before = readFileSync(join(f.directory, "tools.wasm"));
  const receipt = await verifyDevtoolsPackage(f.directory, f.index);
  expect(receipt).toMatchObject({
    verified: true,
    fileCount: 1,
    logicalBytes: before.length,
    signatureVerified: false,
    runtimeAccepted: false,
    fullToolAcceptance: false,
    readOnly: true,
  });
  expect(receipt.files).toEqual(f.files);
  expect(readFileSync(join(f.directory, "tools.wasm"))).toEqual(before);
});

it("recomputes a declared compact JSON files-array index", async () => {
  const f = fixture();
  const directoryIndexEncoding = {
    hash: "SHA-256",
    encoding: "UTF-8",
    content: "files array in listed order",
    objectKeyOrder: ["path", "size", "sha256"],
    ensureAscii: false,
    separators: [",", ":"],
    trailingNewline: false,
  };
  const directoryIndexSha256 = createHash("sha256")
    .update(JSON.stringify(f.files), "utf8")
    .digest("hex");
  writeFileSync(
    f.index,
    JSON.stringify({ files: f.files, directoryIndexEncoding, directoryIndexSha256 }),
  );
  const receipt = await verifyDevtoolsPackage(f.directory, f.index);
  expect(receipt.directoryIndex).toEqual({ status: "matched", sha256: directoryIndexSha256 });

  writeFileSync(
    f.index,
    JSON.stringify({
      files: f.files,
      directoryIndexEncoding,
      directoryIndexSha256: "0".repeat(64),
    }),
  );
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_directory_index_mismatch",
  );
});

it("reports an unspecified index encoding without claiming to have checked it", async () => {
  const f = fixture();
  writeFileSync(f.index, JSON.stringify({ files: f.files, directoryIndexSha256: "0".repeat(64) }));
  const receipt = await verifyDevtoolsPackage(f.directory, f.index);
  expect(receipt.directoryIndex).toEqual({ status: "encoding-unverified" });
});

it("fails command-line intake when a declared directory index cannot be verified", () => {
  const f = fixture();
  writeFileSync(
    f.index,
    JSON.stringify({
      files: f.files,
      directoryIndexEncoding: "compact JSON described in prose",
      directoryIndexSha256: "0".repeat(64),
    }),
  );
  const run = spawnSync(
    process.execPath,
    [resolve("scripts/verify-devtools-package.mjs"), f.directory, f.index],
    { encoding: "utf8" },
  );
  expect(run.status).toBe(1);
  const report = JSON.parse(run.stdout);
  expect(report.verified).toBe(true);
  expect(report.directoryIndex).toEqual({ status: "encoding-unverified" });
});

it("verifies the original receiver bytes index without changing its expected digests", async () => {
  const f = fixture();
  f.files[0].bytes = f.files[0].size;
  delete f.files[0].size;
  f.save();
  const before = readFileSync(f.index);
  const receipt = await verifyDevtoolsPackage(f.directory, f.index);
  expect(receipt).toMatchObject({ verified: true, indexFormat: "legacy-receiver-bytes" });
  expect(receipt.files[0].size).toBe(f.files[0].bytes);
  expect(readFileSync(f.index)).toEqual(before);
  writeFileSync(join(f.directory, "tools.wasm"), Buffer.alloc(f.files[0].bytes, 120));
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_digest_mismatch",
  );
});

it("rejects ambiguous and mixed index size fields", async () => {
  const f = fixture();
  f.files[0].bytes = f.files[0].size;
  f.save();
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_digest_invalid",
  );
  delete f.files[0].bytes;
  f.files.push({ path: "other.wasm", bytes: 1, sha256: f.files[0].sha256 });
  f.save();
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_digest_invalid",
  );
});

it.each([
  "tools?.wasm",
  "tools*.wasm",
  "tools|name.wasm",
  'tools"name.wasm',
  "../outside",
  "sub/../outside",
  "/outside",
  "C:/outside",
  "sub\\outside",
  "//server/share",
  "sub//file",
  "./tools.wasm",
  "tools.wasm.",
  "tools.wasm ",
  "con.txt",
  "sub/NUL",
  "tools\u0000.wasm",
  "sub/COM1.log",
])("rejects nonportable or escaping path %s", async (path) => {
  const f = fixture();
  f.files[0].path = path;
  f.save();
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow("package_path_invalid");
});

it("rejects case-insensitive duplicate index paths", async () => {
  const f = fixture();
  f.files.push({ ...f.files[0], path: "TOOLS.wasm" });
  f.save();
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_duplicate_path",
  );
});

it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid size %s", async (size) => {
  const f = fixture();
  f.files[0].size = size;
  f.save();
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_digest_invalid",
  );
});

it("rejects a changed file even when its byte count is unchanged", async () => {
  const f = fixture();
  writeFileSync(join(f.directory, "tools.wasm"), Buffer.alloc(f.files[0].size));
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_digest_mismatch",
  );
});

it("rejects an unlisted file", async () => {
  const f = fixture();
  writeFileSync(join(f.directory, "unlisted"), "extra");
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_inventory_mismatch",
  );
});

it("requires a package-external verification index", async () => {
  const f = fixture();
  const internal = join(f.directory, "verification.json");
  writeFileSync(internal, readFileSync(f.index));
  await expect(verifyDevtoolsPackage(f.directory, internal)).rejects.toThrow(
    "package_index_must_be_external",
  );
});

it("rejects a directory junction instead of following outside content", async () => {
  const f = fixture();
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "external"), "not package data");
  symlinkSync(
    outside,
    join(f.directory, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_link_forbidden",
  );
});

it("rejects invalid JSON without exposing index contents", async () => {
  const f = fixture();
  writeFileSync(f.index, "synthetic invalid json");
  await expect(verifyDevtoolsPackage(f.directory, f.index)).rejects.toThrow(
    "package_index_json_invalid",
  );
});
