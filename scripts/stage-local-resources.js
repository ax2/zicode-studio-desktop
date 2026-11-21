const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

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
    stage(path.resolve(configDir, source), target, path.join(debugDir, "build", relative));
  }
  return updated;
}

module.exports = { stageLocalResources };
