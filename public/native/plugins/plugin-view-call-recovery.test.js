import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createViewCallRecovery } from "./plugin-view-call-recovery.js";

const scope = { sceneId: "programming", workspaceId: "workspace", pluginId: "plugin",
  capabilityId: "tool.write" };
const callId = "00000000-0000-4000-8000-000000000001";
const hostInstanceId = "00000000-0000-4000-8000-000000000002";
const status = (state, outcome = null) => ({ schemaVersion: 1, profile: "manual.tool.call.v1",
  status: state, executionFinished: state === "finished", outcome });

function setup(overrides = {}) {
  setLocale("en");
  document.body.innerHTML = "<main></main>";
  const gateway = {
    callStatus: vi.fn(async () => status("running")),
    cancelCall: vi.fn(async () => status("cancel_requested")),
    reconcileCall: vi.fn(async () => ({ ...status("finished", "manual_call_retired"),
      profile: "manual.tool.reconcile.v1", callId, hostInstanceId })),
    ...overrides,
  };
  const recovery = createViewCallRecovery({ container: document.querySelector("main"),
    gateway, isCurrent: () => true });
  recovery.issued({ scope, callId, hostInstanceId });
  recovery.uncertain({ scope, callId, hostInstanceId });
  return { recovery, gateway };
}

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); setLocale("zh-CN"); });

it("keeps an uncertain View call locked after a stop acknowledgement and a running status", async () => {
  const { recovery, gateway } = setup();
  expect(recovery.locked("tool.write")).toBe(true);
  const buttons = document.querySelectorAll(".plugin-view-call-recovery button");
  buttons[1].click();
  await vi.waitFor(() => expect(gateway.cancelCall).toHaveBeenCalledWith(scope, callId));
  await vi.waitFor(() => expect(document.querySelectorAll(".plugin-view-call-recovery button")[1].disabled).toBe(false));
  document.querySelector(".plugin-view-call-recovery button").click();
  await vi.waitFor(() => expect(gateway.callStatus).toHaveBeenCalledWith(scope, callId));
  expect(recovery.locked("tool.write")).toBe(true);
  recovery.destroy();
});

it("releases the lock only after a valid terminal status without claiming to have the result", async () => {
  const { recovery } = setup({ callStatus: vi.fn(async () => status("finished", "completed")) });
  document.querySelector(".plugin-view-call-recovery button").click();
  await vi.waitFor(() => expect(recovery.locked("tool.write")).toBe(false));
  expect(document.querySelector(".plugin-view-call-recovery").textContent).toContain("response is unavailable");
  recovery.clearSettled("tool.write");
  expect(document.querySelector(".plugin-view-call-recovery").hidden).toBe(true);
  recovery.destroy();
});

it("reconciles only an unavailable handle with the originally issued Host identity", async () => {
  const missing = Object.assign(new Error("missing"), { code: "manual_call_unavailable" });
  const gateway = { callStatus: vi.fn(async () => { throw missing; }) };
  const { recovery } = setup(gateway);
  document.querySelector(".plugin-view-call-recovery button").click();
  await vi.waitFor(() => expect(recovery.locked("tool.write")).toBe(false));
  recovery.destroy();

  const wrong = setup({ callStatus: gateway.callStatus,
    reconcileCall: vi.fn(async () => ({ ...status("finished", "completed"),
      profile: "manual.tool.reconcile.v1", callId, hostInstanceId: "wrong" })) });
  document.querySelector(".plugin-view-call-recovery button").click();
  await vi.waitFor(() => expect(wrong.gateway.reconcileCall).toHaveBeenCalledOnce());
  expect(wrong.recovery.locked("tool.write")).toBe(true);
  wrong.recovery.destroy();
});

it("keeps a malformed or failed status read uncertain and never exposes a Host handle", async () => {
  const { recovery } = setup({ callStatus: vi.fn(async () => status("finished", null)) });
  document.querySelector(".plugin-view-call-recovery button").click();
  await vi.waitFor(() => expect(document.querySelector(".plugin-view-call-recovery").textContent)
    .toContain("status is unavailable"));
  expect(recovery.locked("tool.write")).toBe(true);
  expect(document.querySelector(".plugin-view-call-recovery").textContent).not.toContain(callId);
  recovery.destroy();
});

it("keeps a live response authoritative even when status reports finished", async () => {
  document.body.innerHTML = "<main></main>";
  const gateway = { callStatus: vi.fn(async () => status("finished", "completed")) };
  const recovery = createViewCallRecovery({ container: document.querySelector("main"),
    gateway, isCurrent: () => true });
  recovery.issued({ scope, callId, hostInstanceId });
  document.querySelector(".plugin-view-call-recovery button").click();
  await vi.waitFor(() => expect(gateway.callStatus).toHaveBeenCalledOnce());
  expect(recovery.locked("tool.write")).toBe(true);
  recovery.delivered({ scope, callId });
  expect(recovery.locked("tool.write")).toBe(false);
  expect(document.querySelector(".plugin-view-call-recovery").hidden).toBe(true);
  recovery.destroy();
});

it("restores an uncertain call after remount and shows a late detached completion", async () => {
  setLocale("en");
  document.body.innerHTML = "<main id='first'></main><main id='second'></main>";
  const calls = new Map();
  const listeners = new Set();
  const gateway = { callStatus: vi.fn(async () => status("finished", "completed")) };
  const first = createViewCallRecovery({ container: document.getElementById("first"),
    gateway, isCurrent: () => true, calls, listeners });
  first.issued({ scope, callId, hostInstanceId });
  first.destroy();
  const second = createViewCallRecovery({ container: document.getElementById("second"),
    gateway, isCurrent: () => true, calls, listeners });
  expect(second.locked("tool.write")).toBe(true);
  first.delivered({ scope, callId });
  expect(second.locked("tool.write")).toBe(false);
  expect(document.getElementById("second").textContent).toContain("response is unavailable");
  second.destroy();
});

it("does not let an old status read release a replacement panel's check", async () => {
  document.body.innerHTML = "<main id='first'></main><main id='second'></main>";
  const pending = [];
  const gateway = { callStatus: vi.fn(() => new Promise(resolve => pending.push(resolve))) };
  const calls = new Map();
  const listeners = new Set();
  const first = createViewCallRecovery({ container: document.getElementById("first"),
    gateway, isCurrent: () => true, calls, listeners });
  first.issued({ scope, callId, hostInstanceId });
  first.uncertain({ scope, callId });
  document.querySelector("#first button").click();
  await vi.waitFor(() => expect(gateway.callStatus).toHaveBeenCalledTimes(1));
  first.destroy();
  const second = createViewCallRecovery({ container: document.getElementById("second"),
    gateway, isCurrent: () => true, calls, listeners });
  document.querySelector("#second button").click();
  await vi.waitFor(() => expect(gateway.callStatus).toHaveBeenCalledTimes(2));
  pending[0](status("running"));
  await Promise.resolve();
  expect(document.querySelector("#second button").disabled).toBe(true);
  pending[1](status("running"));
  await vi.waitFor(() => expect(document.querySelector("#second button").disabled).toBe(false));
  second.destroy();
});
