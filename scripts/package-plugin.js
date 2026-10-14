import { createHash, createPrivateKey, createPublicKey, sign as signPayload } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { zipSync } from "fflate";

const MAX_FILES = 2048;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const BLOCKED_NAMES = new Set([".env", ".env.local", ".env.production"]);
const BLOCKED_EXTENSIONS = new Set([".key", ".pem", ".pfx", ".p12", ".map"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist-private"]);
const RESERVED_WINDOWS_NAMES = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/u;

const args = process.argv.slice(2);
const sourceArg = args[0];
const keyArg = option("--key");
const outputArg = option("--out");
const force = args.includes("--force");
if (!sourceArg || !keyArg) {
  throw new Error(
    "Usage: bun run package:plugin <plugin-directory> --key <ed25519-private-key.pem> [--out <file>] [--force]",
  );
}

const source = resolve(sourceArg);
const keyPath = resolve(keyArg);
const pluginPath = join(source, "plugin.json");
if (!statSync(source).isDirectory() || !existsSync(pluginPath)) {
  throw new Error("Plugin directory must contain plugin.json");
}
const manifest = JSON.parse(readFileSync(pluginPath, "utf8"));
const output = resolve(outputArg ?? `${manifest.id}-${manifest.version}.zicode-plugin`);
if (existsSync(output) && !force) throw new Error(`Output already exists: ${output}`);

const privateKey = createPrivateKey(readFileSync(keyPath));
if (privateKey.asymmetricKeyType !== "ed25519") {
  throw new Error("Signing key must be an Ed25519 private key");
}
const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
const publicKey = publicDer.subarray(publicDer.length - 32);
const publisher = {
  name: String(manifest.publisher ?? "").trim(),
  keyId: sha256(publicKey),
  publicKey: publicKey.toString("base64"),
};
if (!publisher.name) throw new Error("plugin.json publisher is required");

const entries = collectFiles(source);
const files = entries.map(({ path, bytes }) => ({
  path,
  sha256: sha256(bytes),
  size: bytes.length,
}));
const signaturePayload = { schemaVersion: 1, publisher, files };
const packageManifest = {
  ...signaturePayload,
  signature: signPayload(null, Buffer.from(JSON.stringify(signaturePayload)), privateKey).toString(
    "base64",
  ),
};
const archiveEntries = {
  "package.json": new TextEncoder().encode(JSON.stringify(packageManifest, null, 2)),
};
for (const entry of entries) archiveEntries[entry.path] = entry.bytes;
const archive = zipSync(archiveEntries, { level: 9 });
if (archive.length > MAX_PACKAGE_BYTES) throw new Error("Compressed package exceeds 50 MiB");
writeFileSync(output, archive);
console.log(`Created ${output}`);
console.log(`Publisher key fingerprint: ${publisher.keyId}`);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function collectFiles(root) {
  const collected = [];
  let total = 0;
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      const absolute = join(directory, name);
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${absolute}`);
      if (stats.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!stats.isFile()) continue;
      const extension = extname(name).toLowerCase();
      if (
        BLOCKED_NAMES.has(name.toLowerCase()) ||
        BLOCKED_EXTENSIONS.has(extension) ||
        name.endsWith(".zicode-plugin")
      ) {
        throw new Error(`Sensitive or generated file is not allowed in a plugin package: ${name}`);
      }
      if (stats.size > MAX_FILE_BYTES) throw new Error(`File exceeds 10 MiB: ${absolute}`);
      const path = relative(root, absolute).split(sep).join("/");
      if (!portablePackagePath(path)) {
        throw new Error(`Invalid package path: ${path}`);
      }
      const bytes = readFileSync(absolute);
      total += bytes.length;
      if (total > MAX_PACKAGE_BYTES) throw new Error("Expanded package exceeds 50 MiB");
      collected.push({ path, bytes });
      if (collected.length > MAX_FILES) throw new Error("Package exceeds 2,048 files");
    }
  };
  visit(root);
  if (!collected.some((entry) => entry.path === "plugin.json")) {
    throw new Error("Package is missing plugin.json");
  }
  const folded = new Set();
  for (const entry of collected) {
    const key = entry.path.toLowerCase();
    if (folded.has(key)) throw new Error(`Duplicate portable package path: ${entry.path}`);
    folded.add(key);
  }
  return collected.sort((left, right) => left.path.localeCompare(right.path));
}

function portablePackagePath(path) {
  return path.length > 0 && Buffer.byteLength(path, "utf8") <= 512
    && path.toLowerCase() !== "package.json"
    && !path.includes("\\") && !path.includes(":")
    && path.split("/").every((part) => {
      const base = part.split(".")[0].toUpperCase();
      return part.length > 0 && part !== "." && part !== ".."
        && Buffer.byteLength(part, "utf8") <= 255
        && !/[<>:"|?*\p{Cc}]/u.test(part)
        && !/[. ]$/u.test(part)
        && !RESERVED_WINDOWS_NAMES.test(base);
    });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
