import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createProjectFileStatus, projectFileStatusMessage } from "./project-file-status.js";

const preview = { owner: { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" }, grantId: "g", relativePath: "private.txt" };
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); setLocale("zh-CN"); });
function setup(status) {
  setLocale("en");
  let current = true;
  const api = { status: vi.fn(status), prepare: vi.fn(), commit: vi.fn(), cancel: vi.fn() };
  const controller = createProjectFileStatus({ api, isCurrent: () => current });
  document.body.append(controller.element);
  return { api, controller, stale: () => { current = false; } };
}

it("distinguishes active cancellation, ended, published and unknown without granting access", () => {
  expect(projectFileStatusMessage({ schemaVersion: 1, phase: "reading", executionFinished: false, cancellationRequested: true, contentRead: null })).toContain("has not ended");
  expect(projectFileStatusMessage({ schemaVersion: 1, phase: "ended", executionFinished: true, outcome: "cancelled", contentRead: null })).toContain("has ended");
  expect(projectFileStatusMessage({ schemaVersion: 1, phase: "ended", executionFinished: true, outcome: "published", contentRead: true })).toContain("does not restore");
  for (const value of [null, {}, { schemaVersion: 2 }, { schemaVersion: 1, phase: "reading", executionFinished: true }, { schemaVersion: 1, phase: "ended", executionFinished: true, outcome: "published", contentRead: null }]) {
    expect(projectFileStatusMessage(value)).toContain("unknown");
  }
});

it("queries metadata once and refreshes only on an explicit click", async () => {
  const f = setup(async () => ({ schemaVersion: 1, phase: "ended", executionFinished: true, outcome: "failed", contentRead: null }));
  await f.controller.check(preview);
  expect(f.api.status).toHaveBeenCalledExactlyOnceWith(preview.owner, "g");
  expect(document.body.textContent).toContain("failed and has ended");
  expect(document.body.textContent).not.toContain("private.txt");
  document.querySelector("button").click();
  await vi.waitFor(() => expect(f.api.status).toHaveBeenCalledTimes(2));
  expect(f.api.prepare).not.toHaveBeenCalled(); expect(f.api.commit).not.toHaveBeenCalled(); expect(f.api.cancel).not.toHaveBeenCalled();
  f.controller.destroy();
});

it("shows unknown after a bounded wait without starting another pending request", async () => {
  vi.useFakeTimers();
  let release;
  const f = setup(() => new Promise(resolve => { release = resolve; }));
  const pending = f.controller.check(preview);
  await vi.advanceTimersByTimeAsync(3001);
  expect(document.body.textContent).toContain("unknown");
  expect(document.querySelector("button").disabled).toBe(true);
  await f.controller.check(preview);
  expect(f.api.status).toHaveBeenCalledOnce();
  release({ schemaVersion: 1, phase: "ended", executionFinished: true, outcome: "published", contentRead: true });
  await pending;
  expect(document.body.textContent).toContain("unknown");
  expect(document.querySelector("button").disabled).toBe(false);
  f.controller.destroy();
});

it.each(["clear", "destroy", "scope"])("ignores late status after %s", async action => {
  let release;
  const f = setup(() => new Promise(resolve => { release = resolve; }));
  const pending = f.controller.check(preview);
  if (action === "scope") f.stale(); else f.controller[action]();
  release({ schemaVersion: 1, phase: "ended", executionFinished: true, outcome: "published", contentRead: true });
  await pending;
  expect(document.body.textContent).not.toContain("snapshot was created");
  f.controller.destroy();
});

it("treats a missing or malformed receipt as unknown", async () => {
  const f = setup(async () => { throw new Error("resource_file_grant_unavailable"); });
  await f.controller.check(preview);
  expect(document.body.textContent).toContain("Do not assume it has finished");
  f.controller.destroy();
});
