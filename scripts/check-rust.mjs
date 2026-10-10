// Cross-platform launcher for scripts/check-rust.sh.
//
// On Windows, `bash` in PATH is often the WSL bash, which can hang if the WSL
// service is not healthy. Prefer the bundled portable-git bash (the same binary
// the Windows CI job uses) so `bun run check:rust` keeps working locally.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cargoPath from "./cargo-path.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(ROOT, "scripts", "check-rust.sh");

function resolveBash() {
  if (process.platform !== "win32") return "bash";
  const portable = join(ROOT, "src-tauri", "resources", "portable-git", "bin", "bash.exe");
  if (existsSync(portable)) return portable;
  return "bash.exe";
}

const result = spawnSync(resolveBash(), [script, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: cargoPath.withCargoBin(),
});
process.exit(result.status ?? 1);
