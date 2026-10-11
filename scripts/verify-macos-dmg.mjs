import { execFileSync } from "node:child_process";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyExecutableTarget } from "./executable-architecture.mjs";

export function verifyMountedMacosApp(
  app,
  target,
  version,
  piVersion,
  execute = execFileSync,
  checkTarget = verifyExecutableTarget,
) {
  const options = { stdio: ["ignore", "pipe", "inherit"], timeout: 60_000 };
  const actualVersion = execute(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", join(app, "Contents/Info.plist")],
    options,
  )
    .toString()
    .trim();
  if (actualVersion !== version) throw new Error(`App version mismatch: ${actualVersion}`);
  const main = join(app, "Contents/MacOS/zicode-studio-desktop");
  const relay = join(app, "Contents/MacOS/zicode-relay");
  const pi = join(app, "Contents/Resources/pi/pi");
  const bun = join(app, "Contents/Resources/bun/bun");
  for (const binary of [main, relay, pi, bun]) checkTarget(binary, target);
  execute("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app], options);
  execute("codesign", ["--verify", "--strict", "--verbose=2", relay], options);
  const actualPi = execute(pi, ["--version"], options).toString().trim();
  if (actualPi !== piVersion) throw new Error(`Embedded Pi version mismatch: ${actualPi}`);
  const actualBun = execute(bun, ["--version"], options).toString().trim();
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(actualBun)) {
    throw new Error("Embedded Bun did not return a version");
  }
  return { version: actualVersion, pi: actualPi, bun: actualBun, target };
}

export function verifyMacosDmg(
  dmg,
  target,
  version,
  piVersion,
  execute = execFileSync,
  platform = process.platform,
  verifyApp = verifyMountedMacosApp,
) {
  if (platform !== "darwin" || !["darwin-arm64", "darwin-x64"].includes(target)) {
    throw new Error("DMG verification requires a native macOS target");
  }
  const mount = mkdtempSync(join(tmpdir(), "studio-dmg-verification-"));
  let attached = false;
  try {
    execute("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, resolve(dmg)], {
      stdio: "inherit",
      timeout: 60_000,
    });
    attached = true;
    return verifyApp(join(mount, "ZiCode Studio Desktop.app"), target, version, piVersion, execute);
  } finally {
    if (attached) {
      execute("hdiutil", ["detach", mount], { stdio: "inherit", timeout: 60_000 });
    }
    // Only remove the empty mountpoint after a successful detach; never recurse into a volume.
    rmdirSync(mount);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dmg, target, version, piVersion] = process.argv.slice(2);
  if (!dmg || !target || !version || !piVersion)
    throw new Error("Expected DMG, target, app and Pi versions");
  console.log(JSON.stringify(verifyMacosDmg(dmg, target, version, piVersion)));
}
