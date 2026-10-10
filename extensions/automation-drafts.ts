import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface AutomationDraftFields {
  title: string;
  prompt: string;
  targetProject: string;
  schedule: "manual" | "interval" | "daily";
  intervalMinutes: string;
  dailyTime: string;
  requireApproval: boolean;
  maxCost: string;
  maxRetries: string;
}
export interface AutomationDraft extends AutomationDraftFields {
  id: string;
  updatedAt: string;
}
const MAX_BYTES = 8 * 1024 * 1024;
const LIMITS = {
  title: 200,
  prompt: 50000,
  targetProject: 2000,
  intervalMinutes: 32,
  dailyTime: 32,
  maxCost: 32,
  maxRetries: 32,
} as const;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function fields(value: unknown): AutomationDraftFields {
  if (!value || typeof value !== "object") throw new Error("automation_draft_invalid");
  const row = value as Record<string, unknown>;
  for (const [key, limit] of Object.entries(LIMITS)) {
    if (typeof row[key] !== "string" || (row[key] as string).length > limit)
      throw new Error("automation_draft_invalid");
  }
  if (
    typeof row.schedule !== "string" ||
    !["manual", "interval", "daily"].includes(row.schedule) ||
    typeof row.requireApproval !== "boolean"
  )
    throw new Error("automation_draft_invalid");
  return {
    title: row.title as string,
    prompt: row.prompt as string,
    targetProject: row.targetProject as string,
    schedule: row.schedule as AutomationDraftFields["schedule"],
    intervalMinutes: row.intervalMinutes as string,
    dailyTime: row.dailyTime as string,
    requireApproval: row.requireApproval,
    maxCost: row.maxCost as string,
    maxRetries: row.maxRetries as string,
  };
}

function read(file: string): { drafts: AutomationDraft[]; revision: string } {
  let bytes: Buffer;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      if (size > MAX_BYTES) throw new Error("automation_draft_too_large");
      bytes = Buffer.alloc(size + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
        if (!count) break;
        length += count;
      }
      if (length > size) throw new Error("automation_draft_conflict");
      bytes = bytes.subarray(0, length);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { drafts: [], revision: hash("missing") };
    throw error;
  }
  let parsed: { version?: unknown; drafts?: unknown };
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("automation_draft_invalid");
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.drafts) || parsed.drafts.length > 200)
    throw new Error("automation_draft_invalid");
  const ids = new Set<string>();
  const drafts = parsed.drafts.map((row) => {
    const data = fields(row);
    if (
      typeof row.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(row.id) ||
      ids.has(row.id) ||
      typeof row.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(row.updatedAt))
    )
      throw new Error("automation_draft_invalid");
    ids.add(row.id);
    return { ...data, id: row.id, updatedAt: row.updatedAt };
  });
  return { drafts, revision: hash(bytes) };
}

export function automationDraftOperation(file: string, params: Record<string, unknown>) {
  if (params.action === "list") return read(file);
  if (params.action !== "upsert" && params.action !== "remove")
    throw new Error("automation_draft_invalid");
  if (
    typeof params.expectedRevision !== "string" ||
    !/^[a-f0-9]{64}$/.test(params.expectedRevision)
  )
    throw new Error("automation_draft_revision_required");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let fd: number;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error("automation_draft_busy");
    throw error;
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    const current = read(file);
    if (current.revision !== params.expectedRevision) throw new Error("automation_draft_conflict");
    const id = params.id == null ? "" : params.id;
    if (typeof id !== "string" || (id && !/^[a-zA-Z0-9_-]{1,100}$/.test(id)))
      throw new Error("automation_draft_invalid");
    if (id && !current.drafts.some((row) => row.id === id))
      throw new Error("automation_draft_conflict");
    let draft: AutomationDraft | undefined;
    let drafts = current.drafts.filter((row) => row.id !== id);
    if (params.action === "upsert") {
      draft = {
        ...fields(params.draft),
        id: id || randomUUID(),
        updatedAt: new Date().toISOString(),
      };
      drafts = [draft, ...drafts];
    } else if (!id) throw new Error("automation_draft_invalid");
    if (drafts.length > 200) throw new Error("automation_draft_limit");
    const content = JSON.stringify({ version: 1, drafts }, null, 2);
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("automation_draft_too_large");
    const output = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(output, content, "utf8");
      fs.fsyncSync(output);
    } finally {
      fs.closeSync(output);
    }
    fs.renameSync(temporary, file);
    return { drafts, draft, revision: hash(content) };
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch {
      /* No temporary file after a successful rename. */
    }
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
