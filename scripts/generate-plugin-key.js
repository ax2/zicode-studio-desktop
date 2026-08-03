import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(process.argv[2] ?? "publisher-private.pem");
if (existsSync(output) && !process.argv.includes("--force")) {
  throw new Error(`Key already exists: ${output}`);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
writeFileSync(output, privateKey.export({ format: "pem", type: "pkcs8" }), {
  flag: "w",
  mode: 0o600,
});
const publicDer = publicKey.export({ format: "der", type: "spki" });
const rawPublicKey = publicDer.subarray(publicDer.length - 32);
const fingerprint = createHash("sha256").update(rawPublicKey).digest("hex");
console.log(`Created Ed25519 private key: ${output}`);
console.log(`Publisher key fingerprint: ${fingerprint}`);
console.log("Keep this file outside the plugin source tree and never commit it.");
