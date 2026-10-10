import { join } from "node:path";
import { verifyExecutableTarget } from "./executable-architecture.mjs";

const target = process.env.PI_TARGET_PLATFORM;
if (!["windows-x64", "darwin-x64", "darwin-arm64", "linux-x64"].includes(target)) {
  throw new Error(`Unsupported runtime target: ${target || "<missing>"}`);
}
const extension = target === "windows-x64" ? ".exe" : "";
for (const runtime of ["pi", "bun"]) {
  const file = join("src-tauri", "resources", runtime, `${runtime}${extension}`);
  verifyExecutableTarget(file, target);
  console.log(`Verified ${runtime} executable header: ${target}`);
}
