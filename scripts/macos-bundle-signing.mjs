import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyExecutableTarget } from "./executable-architecture.mjs";

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function macosBundleOverride(hookPath, workspaceRoot) {
  if (!isAbsolute(hookPath) || !isAbsolute(workspaceRoot))
    throw new Error("Packaging hook paths must be absolute");
  return {
    build: {
      beforeBundleCommand: {
        cwd: workspaceRoot,
        script: `bun ${shellQuote(hookPath)} --sign`,
      },
    },
  };
}

export function signMacosRelay(
  binary,
  target,
  execute = execFileSync,
  platform = process.platform,
) {
  if (platform !== "darwin" || !["darwin-x64", "darwin-arm64"].includes(target)) {
    throw new Error("Relay ad-hoc signing requires a macOS release target");
  }
  verifyExecutableTarget(binary, target);
  const options = { stdio: "inherit", timeout: 30_000 };
  execute("codesign", ["--force", "--sign", "-", binary], options);
  execute("codesign", ["--verify", "--strict", "--verbose=2", binary], options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== "darwin") throw new Error("This packaging hook runs only on macOS");
  if (process.argv[2] === "--prepare") {
    const config = macosBundleOverride(fileURLToPath(import.meta.url), process.cwd());
    writeFileSync(
      new URL("macos-bundle.json", import.meta.url),
      `${JSON.stringify(config, null, 2)}\n`,
    );
  } else if (process.argv[2] === "--sign") {
    signMacosRelay(
      join(process.cwd(), "target", "release", "zicode-relay"),
      process.env.PI_TARGET_PLATFORM,
    );
  } else {
    throw new Error("Expected --prepare or --sign");
  }
}
