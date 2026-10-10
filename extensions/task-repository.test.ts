// @vitest-environment node

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { readTasks, writeTasks } from "./task-repository";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zicode-task-cas-"));
  roots.push(root);
  return { root, file: path.join(root, "tasks.json") };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("requires a matching version and preserves bytes on conflicts or invalid requests", () => {
  const { root, file } = fixture();
  const initial = readTasks(file);
  const snapshot = vi.fn();
  const saved = writeTasks(file, [{ id: "a", title: "中文" }], initial.revision, snapshot);
  expect(saved.revision).not.toBe(initial.revision);
  expect(readTasks(file)).toEqual(saved);
  const before = fs.readFileSync(file, "utf8");
  expect(() => writeTasks(file, [], initial.revision, snapshot)).toThrow("task_conflict");
  expect(() => writeTasks(file, [], undefined, snapshot)).toThrow("task_revision_required");
  expect(() => writeTasks(file, [{ id: "a" }, { id: "a" }], saved.revision, snapshot)).toThrow(
    "task_store_invalid",
  );
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(fs.readdirSync(root)).toEqual(["tasks.json"]);
  const next = writeTasks(file, [], saved.revision, snapshot);
  expect(next.tasks).toEqual([]);
});

it("fails closed on damaged data, a held lock, or a failed snapshot", () => {
  const { root, file } = fixture();
  fs.writeFileSync(file, "{broken");
  expect(() => readTasks(file)).toThrow("task_store_invalid");
  expect(() => writeTasks(file, [], "a".repeat(64), () => {})).toThrow("task_store_invalid");
  expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  fs.writeFileSync(file, '{"tasks":[]}');
  const old = readTasks(file);
  fs.writeFileSync(`${file}.lock`, '{"pid":123}');
  expect(() => writeTasks(file, [], old.revision, () => {})).toThrow("task_store_busy");
  fs.unlinkSync(`${file}.lock`);
  const snapshot = () => {
    throw new Error("snapshot refused");
  };
  expect(() => writeTasks(file, [{ id: "a" }], old.revision, snapshot)).toThrow("snapshot refused");
  expect(readTasks(file)).toEqual(old);
  expect(fs.readdirSync(root)).toEqual(["tasks.json"]);
});

it("imports legacy data on the first protected write and retains the legacy source", () => {
  const { root, file } = fixture();
  const legacy = path.join(root, "legacy.json");
  fs.writeFileSync(legacy, '{"tasks":[{"id":"old"}]}');
  const initial = readTasks(file, legacy);
  writeTasks(file, [...initial.tasks, { id: "new" }], initial.revision, () => {}, legacy);
  expect(readTasks(file).tasks).toHaveLength(2);
  expect(JSON.parse(fs.readFileSync(legacy, "utf8")).tasks).toEqual([{ id: "old" }]);
});

it("allows only one of two real processes to commit the same read version", async () => {
  const { root, file } = fixture();
  const revision = readTasks(file).revision;
  const gate = path.join(root, "gate");
  const worker = fileURLToPath(new URL("./task-repository-worker.fixture.ts", import.meta.url));
  const children = [0, 1].map(() => {
    const child = spawn("bun", ["run", worker, file, revision, gate], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    const done = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => child.kill(), 8000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        code === 0 ? resolve(output) : reject(new Error(`worker exit ${code}`));
      });
    });
    // Readiness checks may fail before the parent awaits these results.
    void done.catch(() => {});
    return { child, done };
  });
  try {
    await vi.waitFor(
      () => expect(fs.readdirSync(root).filter((name) => name.startsWith("gate.")).length).toBe(2),
      { timeout: 5000 },
    );
    fs.writeFileSync(gate, "go");
    const results = await Promise.all(children.map((item) => item.done));
    expect(results.filter((result) => result === "saved")).toHaveLength(1);
    expect(
      results.filter((result) => ["task_store_busy", "task_conflict"].includes(result)),
    ).toHaveLength(1);
    expect(readTasks(file).tasks).toHaveLength(1);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  } finally {
    for (const { child } of children) if (child.exitCode === null) child.kill();
  }
}, 15000);
