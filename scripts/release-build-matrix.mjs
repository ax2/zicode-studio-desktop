import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseBuildMatrix(platform = "all") {
  const include = [
    { name: "Windows x64", os: "windows-2022", pi_target: "windows-x64", bundles: "nsis" },
    { name: "macOS Apple Silicon", os: "macos-15", pi_target: "darwin-arm64", bundles: "dmg" },
    { name: "macOS Intel", os: "macos-15-intel", pi_target: "darwin-x64", bundles: "dmg" },
    { name: "Linux x64", os: "ubuntu-22.04", pi_target: "linux-x64", bundles: "appimage,deb" },
  ];
  if (platform === "all") return { include };
  if (platform === "macos-intel")
    return { include: include.filter((entry) => entry.pi_target === "darwin-x64") };
  throw new Error("Unsupported release build platform");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing GitHub output path");
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify(releaseBuildMatrix(process.env.RELEASE_PLATFORM))}\n`,
  );
}
