import { expect, it, vi } from "vitest";
import { installProjectWorkNavigation } from "./project-work-navigation.js";

it("routes creation to a form before activation and removes its listener on cleanup", () => {
  const events = new EventTarget();
  const calls = [];
  const activate = vi.fn((id) => calls.push(["activate", id]));
  const taskCenter = { newTask: vi.fn((path) => calls.push(["task", path])) };
  const automation = { newWorkflow: vi.fn((path) => calls.push(["automation", path])) };
  const remove = installProjectWorkNavigation({ events, activate, taskCenter, automation });
  const send = (detail) =>
    events.dispatchEvent(new CustomEvent("zicode:create-project-work", { detail }));
  send({ kind: "task", projectPath: "C:/项目 A" });
  send({ kind: "automation", projectPath: "/home/dev/b" });
  expect(calls).toEqual([
    ["task", "C:/项目 A"],
    ["activate", "com.zicode.tasks"],
    ["automation", "/home/dev/b"],
    ["activate", "com.zicode.automation"],
  ]);
  for (const detail of [
    null,
    { kind: "bad", projectPath: "/a" },
    { kind: "task", projectPath: 2 },
    { kind: "task", projectPath: "" },
    { kind: "task", projectPath: "a\0" },
  ])
    send(detail);
  expect(activate).toHaveBeenCalledTimes(2);
  remove();
  send({ kind: "task", projectPath: "/a" });
  expect(activate).toHaveBeenCalledTimes(2);
});
