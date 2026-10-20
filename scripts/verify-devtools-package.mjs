// Read-only receipt for public producer directories. This is not signature or
// runtime acceptance, and never copies a package or runs provider code.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

function reject(code) {
  throw new Error(code);
}

function portablePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    /[\\:<>"|?*]/.test(value) ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    isAbsolute(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    reject("package_path_invalid");
  return value.toLowerCase();
}

async function digestFile(path) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size, sha256: hash.digest("hex") };
}

function verifyDirectoryIndex(index, sizeField) {
  if (!index.directoryIndexSha256) return { status: "absent" };
  const encoding = index.directoryIndexEncoding;
  if (
    sizeField !== "size" ||
    encoding?.hash !== "SHA-256" ||
    encoding?.encoding !== "UTF-8" ||
    encoding?.content !== "files array in listed order" ||
    JSON.stringify(encoding.objectKeyOrder) !== '["path","size","sha256"]' ||
    encoding.ensureAscii !== false ||
    JSON.stringify(encoding.separators) !== '[",",":"]' ||
    encoding.trailingNewline !== false
  ) {
    return { status: "encoding-unverified" };
  }
  const files = index.files.map(({ path, size, sha256 }) => ({ path, size, sha256 }));
  const digest = createHash("sha256").update(JSON.stringify(files), "utf8").digest("hex");
  if (digest !== index.directoryIndexSha256) reject("package_directory_index_mismatch");
  return { status: "matched", sha256: digest };
}

export async function verifyDevtoolsPackage(packageDirectory, verificationFile) {
  const requestedRoot = resolve(packageDirectory);
  if (!(await lstat(requestedRoot)).isDirectory()) reject("package_root_invalid");
  const root = await realpath(requestedRoot);
  const indexPath = resolve(verificationFile);
  const indexStat = await lstat(indexPath);
  if (!indexStat.isFile() || indexStat.isSymbolicLink()) reject("package_index_invalid");
  const indexRelative = relative(root, await realpath(indexPath));
  if (!indexRelative.startsWith(`..${sep}`) && !isAbsolute(indexRelative)) {
    reject("package_index_must_be_external");
  }
  const indexBytes = await readFile(indexPath);
  let index;
  try {
    index = JSON.parse(indexBytes);
  } catch {
    reject("package_index_json_invalid");
  }
  if (!Array.isArray(index?.files) || !index.files.length) reject("package_inventory_missing");
  // Original receiver snapshots used `bytes`; provider indexes use `size`.
  // Accept one consistent shape, never ambiguous or mixed size declarations.
  const sizeField = ["size", "bytes"].find((field) =>
    index.files.every(
      (item) =>
        item &&
        Object.hasOwn(item, field) &&
        !Object.hasOwn(item, field === "size" ? "bytes" : "size"),
    ),
  );
  if (!sizeField) reject("package_digest_invalid");
  const expected = new Map();
  let logicalBytes = 0;
  for (const item of index.files) {
    const size = item[sizeField];
    const key = portablePath(item?.path);
    if (expected.has(key)) reject("package_duplicate_path");
    if (!Number.isSafeInteger(size) || size < 0 || !/^[a-f0-9]{64}$/.test(item.sha256 ?? ""))
      reject("package_digest_invalid");
    expected.set(key, { ...item, size });
    logicalBytes += size;
    if (!Number.isSafeInteger(logicalBytes)) reject("package_size_invalid");
  }
  const actual = new Map();
  const entryNames = new Set();
  async function walk(directory, prefix = "") {
    for (const entry of await readdir(directory)) {
      const name = prefix + entry;
      const key = portablePath(name);
      if (entryNames.has(key)) reject("package_duplicate_path");
      entryNames.add(key);
      const path = join(directory, entry);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) reject("package_link_forbidden");
      if (stat.isDirectory()) await walk(path, `${name}/`);
      else if (stat.isFile()) {
        if (actual.has(key)) reject("package_duplicate_path");
        actual.set(key, { path, name, size: stat.size });
      } else reject("package_entry_unsupported");
    }
  }
  await walk(root);
  if (actual.size !== expected.size) reject("package_inventory_mismatch");
  const verified = [];
  for (const [key, item] of expected) {
    const file = actual.get(key);
    if (!file || file.name !== item.path || file.size !== item.size) {
      reject("package_inventory_mismatch");
    }
    const digest = await digestFile(file.path);
    if (digest.size !== item.size || digest.sha256 !== item.sha256)
      reject("package_digest_mismatch");
    verified.push({ path: item.path, ...digest });
  }
  // A receipt describes this observation, not a durable lock on a mutable folder.
  if (!(await readFile(indexPath)).equals(indexBytes)) reject("package_index_changed");
  const directoryIndex = verifyDirectoryIndex(index, sizeField);
  return {
    schemaVersion: 1,
    indexFormat: sizeField === "size" ? "provider-size" : "legacy-receiver-bytes",
    verified: true,
    fileCount: verified.length,
    logicalBytes,
    indexSha256: createHash("sha256").update(indexBytes).digest("hex"),
    directoryIndex,
    files: verified,
    signatureVerified: false,
    runtimeAccepted: false,
    fullToolAcceptance: false,
    readOnly: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4)
      reject("usage: verify-devtools-package <directory> <external-verification.json>");
    const result = await verifyDevtoolsPackage(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result, null, 2));
    // File hashes can match while a declared directory index remains unverified.
    // Keep the detailed receipt, but do not let an automated intake treat it as complete.
    if (result.directoryIndex.status === "encoding-unverified") process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ verified: false, code: error.code ?? error.message }));
    process.exitCode = 1;
  }
}
