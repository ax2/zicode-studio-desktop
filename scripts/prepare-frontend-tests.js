import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function prepareFrontend() {
  execFileSync("bun", ["run", "build:frontend"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "inherit",
    windowsHide: true,
  });
}
