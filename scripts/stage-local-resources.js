const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");

const runtimeDirectories = new Set(["pi", "portable-git", "webview2", "bun"]);
const comparisonBatchSize = 16;

function primaryCheckout(configDir) {
  const records = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], {
    cwd: configDir,
    encoding: "utf8",
    windowsHide: true,
  }).split("\0");
  const prefix = "worktree ";
  const checkouts = records.filter((record) => record.startsWith(prefix))
    .map((record) => record.slice(prefix.length));
  const current = fs.realpathSync.native(path.dirname(configDir));
  const registered = checkouts.some((checkout) => {
    try {
      // Git's registered path can have a different spelling from the live Windows path.
      return path.relative(current, fs.realpathSync.native(checkout)) === "";
    } catch {
      // An unavailable worktree cannot establish membership.
      return false;
    }
  });
  if (records[1] === "bare" || !registered) {
    throw Error("Shared runtime resources require a Git checkout.");
  }
  return fs.realpathSync.native(checkouts[0]);
}

async function digest(file, size) {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(4096, size + 1)));
  const fd = await fs.promises.open(file, "r");
  try {
    for (;;) {
      const { bytesRead } = await fd.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      hash.update(chunk.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await fd.close();
  }
}

// Some Cargo layouts put Tauri's prepared resources under debug/build,
// while the Windows application resolves resources beside its executable.
async function stageLocalResources(configDir, debugDir, resources) {
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
    const resolved = fs.realpathSync.native(candidate);
    if (path.relative(expected, resolved) !== "" || !fs.lstatSync(expected).isDirectory()) {
      throw Error(`Shared runtime must point to the corresponding primary checkout directory: ${source}`);
    }
    // Only the known runtime root can be shared. The recursive stager still rejects nested links.
    return resolved;
  }

  function* files(source, target, prepared) {
    const input = fs.lstatSync(source);
    if (input.isDirectory()) {
      const existing = fs.lstatSync(target, { throwIfNoEntry: false });
      if (existing && !existing.isDirectory()) throw Error("Expected a resource directory: " + target);
      if (!existing) fs.mkdirSync(target, { recursive: true });
      for (const name of fs.readdirSync(source)) {
        yield* files(path.join(source, name), path.join(target, name), path.join(prepared, name));
      }
      return;
    }
    if (!input.isFile()) throw Error("Expected a regular resource file: " + target);
    yield { source, target, prepared, size: input.size };
  }

  async function compare(file) {
    const existing = await fs.promises.lstat(file.target).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
    if (existing && !existing.isFile()) throw Error("Expected a regular resource file: " + file.target);
    if (existing?.size !== file.size) return { file };
    // Keep each pair within the batch until both reads have closed, including on failure.
    const [source, target] = await Promise.allSettled([
      digest(file.source, file.size), digest(file.target, file.size),
    ]);
    if (source.status === "rejected") throw source.reason;
    if (target.status === "rejected") throw target.reason;
    const expected = source.value;
    return target.value === expected ? null : { file, expected };
  }

  async function repair({ file: { source, target, prepared, size }, expected }) {
    const intermediate = fs.lstatSync(prepared, { throwIfNoEntry: false });
    const temporary = target + "." + randomUUID() + ".tmp";
    try {
      if (intermediate?.isFile() && intermediate.size === size &&
          (await digest(prepared, size)) === (expected ?? await digest(source, size))) {
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

  async function stageBatch(batch) {
    // Finish the bounded set of reads before reporting failure or repairing files in order.
    const checks = await Promise.allSettled(batch.map(compare));
    for (const check of checks) {
      if (check.status === "rejected") throw check.reason;
      if (check.value) await repair(check.value);
    }
  }

  for (const [source, destination] of Object.entries(resources)) {
    const target = path.resolve(debugDir, destination);
    const relative = path.relative(debugDir, target);
    if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
      throw Error("Resource destination outside the debug directory: " + destination);
    }
    const batch = [];
    const destinations = new Set();
    for (const file of files(resourceSource(source, destination), target, path.join(debugDir, "build", relative))) {
      const key = process.platform === "win32" ? file.target.toLowerCase() : file.target;
      if (batch.length === comparisonBatchSize || destinations.has(key)) {
        await stageBatch(batch);
        batch.length = 0;
        destinations.clear();
      }
      batch.push(file);
      destinations.add(key);
    }
    if (batch.length) await stageBatch(batch);
  }
  return updated;
}

module.exports = { stageLocalResources };
