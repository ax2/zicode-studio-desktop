import * as fs from "node:fs";
import * as path from "node:path";
import { verifyExecutableTarget } from "./executable-architecture.mjs";
import {
  releaseBundleDirectory,
  validateReleaseBundleName,
  validateReleaseBundleTypes,
} from "./release-artifact-policy.mjs";
import { stageBundles } from "./release-candidate-files.mjs";

const bundleTypes = {
  nsis: { directory: "nsis", extension: ".exe" },
  dmg: { directory: "dmg", extension: ".dmg" },
  appimage: { directory: "appimage", extension: ".AppImage" },
  deb: { directory: "deb", extension: ".deb" },
};

const requested = process.argv[2]?.split(",").map((value) => value.trim());
const tag = process.env.RELEASE_TAG;
const sha = process.env.RELEASE_SHA;
if (!requested?.length || !tag || !sha || !process.env.RUNNER_TEMP)
  throw Error("Missing frozen release context");
validateReleaseBundleTypes(process.env.PI_TARGET_PLATFORM, requested);

const bundleDirectory = releaseBundleDirectory(
  process.cwd(),
  process.env.CARGO_TARGET_DIR,
  process.env.CARGO_BUILD_TARGET,
);

const files = [];
const executableName = `zicode-studio-desktop${process.env.PI_TARGET_PLATFORM === "windows-x64" ? ".exe" : ""}`;
const executable = path.join(path.dirname(bundleDirectory), executableName);
if (!fs.existsSync(executable)) throw new Error(`Release executable missing: ${executable}`);
verifyExecutableTarget(executable, process.env.PI_TARGET_PLATFORM);
for (const type of requested) {
  const bundle = bundleTypes[type];
  if (!bundle) throw new Error(`Unsupported release bundle type: ${type}`);
  const directory = path.join(bundleDirectory, bundle.directory);
  const matches = fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter((name) => name.endsWith(bundle.extension))
        .map((name) => path.join(directory, name))
        .filter((filePath) => fs.lstatSync(filePath).isFile())
    : [];
  if (matches.length !== 1) {
    throw new Error(`Expected one ${type} bundle in ${directory}, found ${matches.length}`);
  }
  const filePath = matches[0];
  validateReleaseBundleName(process.env.PI_TARGET_PLATFORM, type, filePath);
  if (fs.statSync(filePath).size === 0) throw new Error(`Empty release bundle: ${filePath}`);
  files.push(filePath);
}

const installerAcceptance =
  process.env.PI_TARGET_PLATFORM === "windows-x64"
    ? JSON.parse(
        fs.readFileSync(
          path.join(process.env.RUNNER_TEMP, "studio-installer-acceptance.json"),
          "utf8",
        ),
      )
    : undefined;

await stageBundles(files, path.join(process.env.RUNNER_TEMP, "studio-verified-bundles"), {
  tag,
  sha,
  target: process.env.PI_TARGET_PLATFORM,
  installerAcceptance,
});
