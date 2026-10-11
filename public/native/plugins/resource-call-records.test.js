import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createResourceCallRecords } from "./resource-call-records.js";
import { resourceCallRecord } from "./resource-call-journal.js";
import { admission, reconciliation } from "../../../tests/helpers/resource-call-admission.js";
const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
const target = { instanceId: "r", sessionId: "s", workspaceId: "ws", sceneId: "programming" };
beforeEach(() => { setLocale("en"); document.body.replaceChildren(); });
function setup() {
  const record = resourceCallRecord(target, owner, admission(owner));
  const gateway = { resourceCalls: { list: vi.fn(async () => [record]), remove: vi.fn(async () => {}) },
    reconcileResourceCall: vi.fn(async () => reconciliation(owner, record.ticket.callId, "ended")) };
  let current = target; const confirm = vi.fn(() => false);
  const container = document.createElement("div"); document.body.append(container);
  const panel = createResourceCallRecords({ container, gateway, scope: target, getTarget: () => current, confirm });
  const click = name => [...container.querySelectorAll("button")].find(button => button.textContent === name).click();
  return { gateway, record, panel, click, confirm, container, change() { current = { ...target, workspaceId: "other" }; } };
}
describe("project call record recovery", () => {
  it("loads only on explicit request and removes only after a bound completion proof", async () => {
    const f = setup(); expect(f.gateway.resourceCalls.list).not.toHaveBeenCalled();
    f.click("Review tool call records"); await vi.waitFor(() => expect(f.container.textContent).toContain("p · c"));
    expect(f.gateway.reconcileResourceCall).not.toHaveBeenCalled();
    f.click("Stop and recover call"); await vi.waitFor(() => expect(f.gateway.resourceCalls.remove).toHaveBeenCalledWith(f.record));
    expect(f.container.textContent).toContain("Its result was not recovered"); f.panel.destroy();
  });
  it.each(["active", "wrongHost", "invalid", "failure"])("retains records after %s without claiming completion", async phase => {
    const f = setup(); f.click("Review tool call records"); await vi.waitFor(() => expect(f.container.querySelector("article")).not.toBeNull());
    f.gateway.reconcileResourceCall.mockImplementation(async () => {
      if (phase === "failure") throw new Error("private");
      if (phase === "wrongHost") throw { code: "resource_call_host_changed" };
      return { ...reconciliation(owner, f.record.ticket.callId, "active"), ...(phase === "invalid" ? { executionFinished: true } : {}) };
    });
    f.click("Stop and recover call"); await vi.waitFor(() => expect(f.gateway.reconcileResourceCall).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect([...f.container.querySelectorAll("button")].every(button => !button.disabled)).toBe(true));
    expect(f.gateway.resourceCalls.remove).not.toHaveBeenCalled(); expect(f.container.querySelector("article")).not.toBeNull();
    expect(f.container.textContent).not.toContain("private"); f.panel.destroy();
  });
  it("requires explicit confirmation to forget and never sends a cancellation for forgetting", async () => {
    const f = setup(); f.click("Review tool call records"); await vi.waitFor(() => expect(f.container.querySelector("article")).not.toBeNull());
    f.click("Forget call record"); expect(f.gateway.resourceCalls.remove).not.toHaveBeenCalled();
    f.confirm.mockReturnValue(true); f.click("Forget call record"); await vi.waitFor(() => expect(f.gateway.resourceCalls.remove).toHaveBeenCalledOnce());
    expect(f.gateway.reconcileResourceCall).not.toHaveBeenCalled(); f.panel.destroy();
  });
  it("retains a record if its request completes after teardown or workspace change", async () => {
    const f = setup(); f.click("Review tool call records"); await vi.waitFor(() => expect(f.container.querySelector("article")).not.toBeNull());
    let finish; f.gateway.reconcileResourceCall.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    f.click("Stop and recover call"); f.change(); f.panel.destroy(); finish(reconciliation(owner, f.record.ticket.callId, "ended"));
    await Promise.resolve(); expect(f.gateway.resourceCalls.remove).not.toHaveBeenCalled();
  });
});
