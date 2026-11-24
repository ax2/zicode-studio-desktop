const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");

const runtimeDirectories = new Set(["pi", "portable-git", "webview2", "bun"]);

function primaryCheckout(configDir) {
  const records = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd: configDir,
    encoding: "utf8",
    windowsHide: true,
  }).split("\0");
  const prefix = "worktree ";
  const checkouts = records.filter((record) => record.startsWith(prefix))
    .map((record) => record.slice(prefix.length));
  const current = fs.realpathSync(path.dirname(configDir));
  if (records[1] === "bare" || !checkouts.some((checkout) => path.relative(current, checkout) === "")) {
    throw Error("Shared runtime resources require a Git checkout.");
  }
  return fs.realpathSync(checkouts[0]);
}

function digest(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const chunk = Buffer.allocUnsafe(256 * 1024);
  try {
    for (;;) {
      const length = fs.readSync(fd, chunk);
      if (length === 0) break;
      hash.update(chunk.subarray(0, length));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

// Some Cargo layouts put Tauri's prepared resources under debug/build,
// while the Windows application resolves resources beside its executable.
function stageLocalResources(configDir, debugDir, resources) {
  let updated = 0;
  let primary;

  function resourceSource(source, destination) {
    const candidate = path.resolve(configDir, source);
    const resourcePath = path.join("resources", destination);
    if (!runtimeDirectories.has(destination)
      || path.relative(configDir, candidate) !== resourcePath
      || !fs.lstatSync(candidate).isSymbolicLink()) {
      return candidate;
    }

    primary ??= primaryCheckout(configDir);
    const expected = path.join(primary, "src-tauri", resourcePath);
    const resolved = fs.realpathSync(candidate);
    if (path.relative(expected, resolved) !== "" || !fs.lstatSync(expected).isDirectory()) {
      throw Error(`Shared runtime must point to the corresponding primary checkout directory: ${source}`);
    }
    // Only the known runtime root can be shared. The recursive stager still rejects nested links.
    return resolved;
  }

  function stage(source, target, prepared) {
    const input = fs.lstatSync(source);
    const existing = fs.lstatSync(target, { throwIfNoEntry: false });
    if (input.isDirectory()) {
      if (existing && !existing.isDirectory()) throw Error("Expected a resource directory: " + target);
      fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(source)) {
        stage(path.join(source, name), path.join(target, name), path.join(prepared, name));
      }
      return;
    }
    if (!input.isFile() || (existing && !existing.isFile())) throw Error("Expected a regular resource file: " + target);
    const expected = digest(source);
    if (existing && existing.size === input.size && digest(target) === expected) return;
    const intermediate = fs.lstatSync(prepared, { throwIfNoEntry: false });
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      if (intermediate?.isFile() && intermediate.size === input.size && digest(prepared) === expected) {
        // Reuse the build artifact without linking the runnable copy to editable source.
        try { fs.linkSync(prepared, temporary); }
        catch (error) {
          if (!["EXDEV", "EPERM", "ENOTSUP", "EMLINK"].includes(error.code)) throw error;
          fs.copyFileSync(source, temporary);
        }
      } else {
        fs.copyFileSync(source, temporary);
      }
      fs.renameSync(temporary, target);
      updated++;
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  for (const [source, destination] of Object.entries(resources)) {
    const target = path.resolve(debugDir, destination);
    const relative = path.relative(debugDir, target);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      throw Error("Resource destination outside the debug directory: " + destination);
    }
    stage(resourceSource(source, destination), target, path.join(debugDir, "build", relative));
  }
  return updated;
}

module.exports = { stageLocalResources };
