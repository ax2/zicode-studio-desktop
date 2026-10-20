import { basename, join, resolve } from "node:path";

const targets = {
  "windows-x64": { nsis: "_x64-setup.exe" },
  "darwin-arm64": { dmg: "_aarch64.dmg" },
  "darwin-x64": { dmg: "_x64.dmg" },
  "linux-x64": { appimage: "_amd64.AppImage", deb: "_amd64.deb" },
};

export function validateReleaseBundleTypes(target, requested) {
  const expected = targets[target];
  if (!expected) throw new Error(`Unsupported release target: ${target || "<missing>"}`);
  if (
    new Set(requested).size !== requested.length ||
    requested.length !== Object.keys(expected).length ||
    requested.some((type) => !Object.hasOwn(expected, type))
  ) {
    throw new Error(
      `Release target ${target} requires exactly: ${Object.keys(expected).join(", ")}`,
    );
  }
}

export function validateReleaseBundleName(target, type, filePath) {
  const suffix = targets[target]?.[type];
  if (!suffix || !basename(filePath).endsWith(suffix)) {
    throw new Error(
      `Bundle architecture does not match ${target || "<missing>"} (${type}): ${filePath}`,
    );
  }
}

export function missingReleaseBundlesMessage(files) {
  return `Draft release is missing matching bundles: ${files.map((file) => basename(file)).join(", ")}`;
}

// Release builds run from the repository root and use one Cargo target tree.
// Do not accept a stale bundle from src-tauri/target when the configured tree
// is missing; the verifier must inspect the same output as the build step.
export function releaseBundleDirectory(cwd, cargoTargetDir, cargoBuildTarget) {
  const target = resolve(cwd, cargoTargetDir?.trim() || "target");
  return join(
    target,
    ...(cargoBuildTarget?.trim() ? [cargoBuildTarget.trim()] : []),
    "release",
    "bundle",
  );
}
