import { execFileSync } from "node:child_process";

const targets = {
  "windows-x64": { platform: "win32", arch: "x64", rust: "x86_64-pc-windows-msvc" },
  "darwin-arm64": { platform: "darwin", arch: "arm64", rust: "aarch64-apple-darwin" },
  "darwin-x64": { platform: "darwin", arch: "x64", rust: "x86_64-apple-darwin" },
  "linux-x64": { platform: "linux", arch: "x64", rust: "x86_64-unknown-linux-gnu" },
};

const target = process.env.PI_TARGET_PLATFORM;
const expected = targets[target];
if (!expected) {
  throw new Error(`Unsupported release target: ${target || "<missing>"}`);
}

const rustc = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const rustHost = rustc.match(/^host:\s+(\S+)/m)?.[1];
const cargoTarget = process.env.CARGO_BUILD_TARGET?.trim();
if (
  process.platform !== expected.platform ||
  process.arch !== expected.arch ||
  rustHost !== expected.rust ||
  (cargoTarget && cargoTarget !== expected.rust)
) {
  throw new Error(
    `Release target ${target} does not match runner ${process.platform}-${process.arch}, Rust host ${rustHost || "<unknown>"}, and Cargo build target ${cargoTarget || "<default>"}`,
  );
}

console.log(
  `Release target ${target} matches runner, Rust host ${rustHost}, and Cargo build target ${cargoTarget || "<default>"}.`,
);
