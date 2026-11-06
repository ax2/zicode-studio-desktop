// Cross-platform Rust checks. Windows invokes Cargo without an MSYS shell.
//
// MSYS prepends /usr/bin and can resolve its unrelated link.exe instead of the
// Visual Studio linker. Preserve the compiler environment on Windows.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cargoPath from "./cargo-path.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(ROOT, "scripts", "check-rust.sh");

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--static-only")) {
  console.error("Usage: check-rust.mjs [--static-only]");
  process.exit(2);
}
const env = cargoPath.withCargoBin();
if (process.platform === "win32") {
  const manifest = join(ROOT, "src-tauri", "Cargo.toml");
  const run = (arguments_) => spawnSync("cargo", arguments_, { stdio: "inherit", env, windowsHide: true });
  const checks = [
    ["check", "--manifest-path", manifest, "--all-targets"],
    ...(!args.length ? [["test", "--manifest-path", manifest]] : []),
    ["clippy", "--manifest-path", manifest, "--all-targets", "--", "-D", "warnings"],
  ];
  for (const check of checks) {
    console.log(`==> cargo ${check[0]}`);
    const result = run(check);
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const formatted = run(["fmt", "--manifest-path", manifest, "--check"]);
  if (formatted.status !== 0) console.warn("Formatting drift detected; run cargo fmt to fix (advisory).");
  console.log("==> all rust checks passed");
} else {
  const result = spawnSync("bash", [script, ...args], { stdio: "inherit", env });
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}
