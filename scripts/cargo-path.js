const { existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function withCargoBin(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  // Resolve relative overrides against the project, never the caller's cwd.
  // Tauri and the Rust checks can otherwise populate different target trees.
  env.CARGO_TARGET_DIR = path.resolve(
    __dirname,
    "..",
    env.CARGO_TARGET_DIR?.trim() || "target",
  );
  const cargoHome = env.CARGO_HOME || path.join(os.homedir(), ".cargo");
  const cargoBin = path.join(cargoHome, "bin");
  const cargo = path.join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo");
  if (!existsSync(cargo)) return env;

  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const entries = (env[pathKey] || "").split(path.delimiter);
  const matches = (entry) =>
    process.platform === "win32"
      ? path.normalize(entry).toLowerCase() === path.normalize(cargoBin).toLowerCase()
      : entry === cargoBin;
  if (!entries.some(matches))
    env[pathKey] = [cargoBin, env[pathKey]].filter(Boolean).join(path.delimiter);
  return env;
}

module.exports = { withCargoBin };
