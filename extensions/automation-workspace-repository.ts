import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { hostname } from "node:os";
import * as path from "node:path";

const MAX_BYTES = 8 * 1024 * 1024;
const STALE_LOCK_MIN_AGE_MS = 60_000;
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

function reclaimDeadLock(lock: string): boolean {
  const recovery = `${lock}.recover`;
  try {
    fs.mkdirSync(recovery);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    const before = fs.lstatSync(lock);
    if (!before.isFile() || before.isSymbolicLink() || before.size > 512) return false;
    let owner: { pid?: unknown; hostname?: unknown; nonce?: unknown; createdAt?: unknown };
    try {
      const fd = fs.openSync(lock, "r");
      try {
        const opened = fs.fstatSync(fd);
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
          return false;
        const bytes = Buffer.alloc(513);
        const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
        if (length !== before.size) return false;
        owner = JSON.parse(bytes.subarray(0, length).toString("utf8"));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }
    if (
      !owner ||
      typeof owner !== "object" ||
      Array.isArray(owner) ||
      !Number.isSafeInteger(owner.pid) ||
      Number(owner.pid) <= 0 ||
      owner.hostname !== hostname() ||
      typeof owner.nonce !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(owner.nonce) ||
      typeof owner.createdAt !== "string"
    )
      return false;
    const age = Date.now() - Date.parse(owner.createdAt);
    if (!Number.isFinite(age) || age < STALE_LOCK_MIN_AGE_MS) return false;
    try {
      process.kill(Number(owner.pid), 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
    }
    const after = fs.lstatSync(lock);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      return false;
    fs.unlinkSync(lock);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  } finally {
    fs.rmdirSync(recovery);
  }
}

export interface AutomationSnapshot<T> {
  version: 1;
  workflows: T[];
  revision: string;
}

function readFile<T>(file: string, normalize: (value: unknown) => T): AutomationSnapshot<T> {
  let bytes: Buffer;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size > MAX_BYTES) throw new Error("automation_workspace_too_large");
      bytes = Buffer.alloc(size + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
        if (!count) break;
        length += count;
      }
      if (length !== size) throw new Error("automation_workspace_conflict");
      bytes = bytes.subarray(0, length);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { version: 1, workflows: [], revision: digest("missing") };
    throw error;
  }
  let parsed: { version?: unknown; workflows?: unknown };
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("automation_workspace_invalid");
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.workflows) || parsed.workflows.length > 200)
    throw new Error("automation_workspace_invalid");
  const ids = new Set<string>();
  const workflows = parsed.workflows.map((workflow) => {
    const id = (workflow as { id?: unknown })?.id;
    if (typeof id !== "string" || !id || ids.has(id))
      throw new Error("automation_workspace_invalid");
    ids.add(id);
    return normalize(workflow);
  });
  return { version: 1, workflows, revision: digest(bytes) };
}

export function readAutomationWorkspaceFile<T>(
  file: string,
  legacy: string,
  normalize: (value: unknown) => T,
): AutomationSnapshot<T> {
  return readFile(fs.existsSync(file) ? file : legacy, normalize);
}

export function updateAutomationWorkspaceFile<T>(
  file: string,
  legacy: string,
  expected: unknown,
  normalize: (value: unknown) => T,
  update: (workflows: T[]) => { workflows: T[]; value?: T },
  snapshot: (file: string) => void,
): AutomationSnapshot<T> & { value?: T } {
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("automation_workspace_revision_required");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let lockFd: number;
  try {
    lockFd = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (!reclaimDeadLock(lock)) throw new Error("automation_workspace_busy");
    try {
      lockFd = fs.openSync(lock, "wx", 0o600);
    } catch (retryError) {
      if ((retryError as NodeJS.ErrnoException).code === "EEXIST")
        throw new Error("automation_workspace_busy");
      throw retryError;
    }
  }
  try {
    fs.writeFileSync(
      lockFd,
      JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        nonce: randomUUID(),
        createdAt: new Date().toISOString(),
      }),
    );
    const current = readAutomationWorkspaceFile(file, legacy, normalize);
    if (current.revision !== expected) throw new Error("automation_workspace_conflict");
    const changed = update([...current.workflows]);
    if (changed.workflows.length > 200) throw new Error("automation_workspace_limit");
    const content = JSON.stringify({ version: 1, workflows: changed.workflows }, null, 2);
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("automation_workspace_too_large");
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(fd, content, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      snapshot(file);
      fs.renameSync(temporary, file);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* Successful rename leaves no temporary file. */
      }
    }
    return {
      version: 1,
      workflows: changed.workflows,
      revision: digest(content),
      value: changed.value,
    };
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}
