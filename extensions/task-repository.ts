import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_BYTES = 8 * 1024 * 1024;
export interface TaskSnapshot {
  tasks: unknown[];
  revision: string;
}

function validate(tasks: unknown): asserts tasks is unknown[] {
  if (!Array.isArray(tasks)) throw new Error("task_store_invalid");
  const ids = new Set<string>();
  for (const task of tasks) {
    const id = (task as { id?: unknown })?.id;
    if (!task || typeof task !== "object" || typeof id !== "string" || !id || ids.has(id))
      throw new Error("task_store_invalid");
    ids.add(id);
  }
}

function revision(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readFile(file: string): TaskSnapshot {
  let bytes: Buffer;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size > MAX_BYTES) throw new Error("task_store_too_large");
      bytes = Buffer.alloc(size + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
        if (!count) break;
        length += count;
      }
      if (length > MAX_BYTES) throw new Error("task_store_too_large");
      bytes = bytes.subarray(0, length);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { tasks: [], revision: revision("missing") };
    throw error;
  }
  let parsed: { tasks?: unknown };
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("task_store_invalid");
  }
  validate(parsed?.tasks);
  return { tasks: parsed.tasks, revision: revision(bytes) };
}

function atomicWrite(file: string, content: string): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, content, "utf8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Cleanup is best effort; never mask the primary write/rename failure.
    }
  }
}

export function readTasks(file: string, legacy?: string): TaskSnapshot {
  return readFile(!fs.existsSync(file) && legacy && fs.existsSync(legacy) ? legacy : file);
}

export function writeTasks(
  file: string,
  tasks: unknown,
  expected: unknown,
  snapshot: (file: string) => void,
  legacy?: string,
): TaskSnapshot {
  validate(tasks);
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error("task_revision_required");
  const content = JSON.stringify({ tasks }, null, 2);
  if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("task_store_too_large");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let fd: number;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("task_store_busy");
    throw error;
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    const current = readTasks(file, legacy);
    if (current.revision !== expected) throw new Error("task_conflict");
    snapshot(file);
    atomicWrite(file, content);
    return { tasks, revision: revision(content) };
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
