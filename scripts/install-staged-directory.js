const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function pathPresent(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** Restore the sole complete previous tree after an interrupted directory switch. */
function recoverStagedDirectory(outputDir, label) {
  const parent = path.dirname(outputDir);
  if (!pathPresent(parent)) return false;
  const base = path.basename(outputDir);
  const backupPrefix = `${base}.backup-`;
  const entries = fs.readdirSync(parent, { withFileTypes: true });
  const backups = entries.filter(
    (entry) =>
      entry.isDirectory() &&
      entry.name.startsWith(backupPrefix) &&
      /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
        entry.name.slice(backupPrefix.length),
      ),
  );
  const stages = entries.filter(
    (entry) => entry.isDirectory() && entry.name.startsWith(`.${base}-stage-`),
  );
  if (stages.length > 0) {
    console.warn(
      `[${label}] ${stages.length} interrupted staging director${stages.length === 1 ? "y" : "ies"} remain beside ${outputDir}`,
    );
  }
  if (pathPresent(outputDir)) {
    if (backups.length > 0) {
      console.warn(
        `[${label}] ${backups.length} previous resource director${backups.length === 1 ? "y" : "ies"} remain beside ${outputDir}`,
      );
    }
    return false;
  }
  if (backups.length > 1) {
    throw new Error(
      `Multiple previous resource directories remain beside ${outputDir}; inspect them before continuing`,
    );
  }
  if (backups.length === 1) {
    const backup = path.join(parent, backups[0].name);
    fs.renameSync(backup, outputDir);
    console.warn(`[${label}] Restored previous resource directory from ${backup}`);
    return true;
  }
  return false;
}

/** Prepare a complete resource tree beside its target, then switch directories. */
function installStagedDirectory(outputDir, label, prepare) {
  const parent = path.dirname(outputDir);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(outputDir)}-stage-`));
  const backup = `${outputDir}.backup-${crypto.randomUUID()}`;
  let movedPrevious = false;
  try {
    prepare(staging);
    if (pathPresent(outputDir)) {
      fs.renameSync(outputDir, backup);
      movedPrevious = true;
    }
    fs.renameSync(staging, outputDir);
  } catch (error) {
    if (movedPrevious && !pathPresent(outputDir)) {
      try {
        fs.renameSync(backup, outputDir);
      } catch (rollbackError) {
        throw new Error(
          `${label} install failed; previous resource remains at ${backup}: ${errorMessage(error)}; rollback: ${errorMessage(rollbackError)}`,
        );
      }
    }
    throw error;
  } finally {
    if (fs.existsSync(staging)) {
      try {
        fs.rmSync(staging, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[${label}] Staged files remain at ${staging}: ${errorMessage(error)}`);
      }
    }
  }
  if (movedPrevious) {
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[${label}] Previous resource remains at ${backup}: ${errorMessage(error)}`);
    }
  }
}

module.exports = { installStagedDirectory, recoverStagedDirectory };
