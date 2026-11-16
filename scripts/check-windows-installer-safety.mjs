import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// The template is based on the CLI's internal template; upgrading the CLI
// requires reapplying and validating the safety changes against the new source.
const expectedCli = "2.11.2";
const expectedTemplateSha256 = "0558bfd08762b379da4f2d73a52772291ddb4fa82c532e7f8ac2e5af7d76998e";
const lock = readFileSync("bun.lock", "utf8");
const match = lock.match(/"@tauri-apps\/cli":\s*\["@tauri-apps\/cli@([^\"]+)"/);
if (match?.[1] !== expectedCli) {
  throw new Error(`Review Windows installer safety before changing Tauri CLI ${expectedCli} (found ${match?.[1] ?? "none"})`);
}
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
if (config.bundle?.windows?.nsis?.template !== "./windows/installer-safe.nsi") {
  throw new Error("The process-safe Windows installer template must remain enabled");
}
const template = readFileSync("src-tauri/windows/installer-safe.nsi", "utf8").replaceAll("\r\n", "\n");
const hash = createHash("sha256").update(template).digest("hex");
if (hash !== expectedTemplateSha256) {
  throw new Error("Windows installer template changed: review process safety and update the pinned template checksum");
}
console.log(`Windows installer template pinned to Tauri CLI ${expectedCli}`);
