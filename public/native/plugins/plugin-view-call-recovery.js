import { t } from "../../i18n.js";

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const STATUSES = new Set(["prepared", "running", "cancel_requested", "finished"]);

function validStatus(value) {
  return value?.schemaVersion === 1 && value.profile === "manual.tool.call.v1" &&
    STATUSES.has(value.status) && value.executionFinished === (value.status === "finished") &&
    (value.executionFinished
      ? typeof value.outcome === "string" && value.outcome.length > 0 && value.outcome.length <= 128
      : value.outcome === null);
}

// Host call handles stay in the trusted parent. This panel only queries their
// state; it never replays the possibly side-effecting operation.
export function createViewCallRecovery({ container, gateway, isCurrent,
  calls = new Map(), listeners = new Set() }) {
  const panel = document.createElement("section");
  panel.className = "plugin-view-call-recovery";
  panel.hidden = true;
  panel.setAttribute("role", "status");
  container.append(panel);
  let destroyed = false;

  function render() {
    if (destroyed) return;
    panel.replaceChildren();
    panel.hidden = calls.size === 0;
    for (const [capabilityId, call] of calls) {
      const item = document.createElement("div");
      item.className = "plugin-view-call-recovery-item";
      const title = document.createElement("strong");
      title.textContent = capabilityId;
      const status = document.createElement("p");
      status.textContent = t(call.message);
      item.append(title, status);
      if (call.locked) {
        const check = document.createElement("button");
        check.type = "button";
        check.className = "ui-button ui-button--secondary";
        check.textContent = t("Check tool status");
        check.disabled = call.checking;
        check.addEventListener("click", () => void inspect(call, false));
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "ui-button ui-button--secondary";
        stop.textContent = t("Request tool stop");
        stop.disabled = call.checking;
        stop.addEventListener("click", () => void inspect(call, true));
        item.append(check, stop);
      }
      panel.append(item);
    }
  }
  listeners.add(render);
  const publish = () => { for (const listener of listeners) listener(); };
  render();

  async function inspect(call, stop) {
    if (destroyed || call.checking || !call.locked || !isCurrent() ||
        calls.get(call.scope.capabilityId) !== call) return;
    call.checking = true;
    publish();
    try {
      let status;
      try {
        status = stop
          ? await gateway.cancelCall(call.scope, call.callId)
          : await gateway.callStatus(call.scope, call.callId);
      } catch (error) {
        if (stop || error?.code !== "manual_call_unavailable" ||
            !UUID.test(call.hostInstanceId ?? "") ||
            typeof gateway.reconcileCall !== "function") throw error;
        const proof = await gateway.reconcileCall(call.scope, call.callId, call.hostInstanceId);
        if (proof?.schemaVersion !== 1 || proof.profile !== "manual.tool.reconcile.v1" ||
            proof.callId !== call.callId || proof.hostInstanceId !== call.hostInstanceId) {
          throw new Error("Invalid reconciliation proof");
        }
        status = { ...proof, profile: "manual.tool.call.v1" };
      }
      if (!isCurrent() || calls.get(call.scope.capabilityId) !== call) return;
      if (!validStatus(status)) throw new Error("Invalid call status");
      if (status.executionFinished && call.awaitingResponse && !call.detached) {
        call.message = "The tool ended. Waiting for its response.";
      } else if (status.executionFinished) {
        call.locked = false;
        call.message = status.outcome === "worker_cancelled"
          ? "The tool stopped. Its response was not received."
          : "The tool ended, but its response is unavailable. Check its effects before running it again.";
      } else {
        call.message = stop
          ? "Stop requested. The tool may still be running."
          : "The tool may still be running. Check again or request it to stop.";
      }
    } catch {
      if (isCurrent() && calls.get(call.scope.capabilityId) === call)
        call.message = "Tool status is unavailable. The tool may still be running.";
    } finally {
      if (!destroyed) call.checking = false;
      publish();
    }
  }

  return {
    locked(capabilityId) { return calls.get(capabilityId)?.locked === true; },
    clearSettled(capabilityId) {
      if (calls.get(capabilityId)?.locked === false) {
        calls.delete(capabilityId);
        publish();
      }
    },
    issued({ scope, callId, hostInstanceId }) {
      if (destroyed || !isCurrent() || !UUID.test(callId ?? "")) return;
      calls.set(scope.capabilityId, { scope: { ...scope }, callId, hostInstanceId,
        locked: true, checking: false, awaitingResponse: true, detached: false,
        message: "The tool is running. Wait for its response." });
      publish();
    },
    delivered({ scope, callId }) {
      const call = calls.get(scope.capabilityId);
      if (!call || call.callId !== callId) return;
      if (destroyed || !isCurrent() || call.detached) {
        call.awaitingResponse = false;
        call.locked = false;
        call.message = "The tool ended, but its response is unavailable. Check its effects before running it again.";
      } else calls.delete(scope.capabilityId);
      publish();
    },
    uncertain({ scope, callId }) {
      const call = calls.get(scope.capabilityId);
      if (!call || call.callId !== callId || !call.locked) return;
      call.awaitingResponse = false;
      call.message = "Tool result is unknown. Check its status before running it again.";
      publish();
    },
    destroy() {
      destroyed = true;
      listeners.delete(render);
      for (const call of calls.values()) {
        call.detached = true;
        call.awaitingResponse = false;
        call.checking = false;
      }
      panel.remove();
    },
  };
}
