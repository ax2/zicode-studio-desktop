import { useEffect, useRef, useState } from "react";
import { type ManualCallRequest, type ManualCallScope, manualCallProfile, validCallStatus } from "./manual-call-protocol";
import type { ManualToolApi } from "./manual-tools";
import { type CallDiagnostics, type CallDiagnosticEvent, appendCallDiagnostic, manualCallFailureNotice } from "./manual-call-diagnostics";

type Phase = "idle" | "preparing" | "running" | "cancelling" | "uncertain" | "cancelled" | "completed" | "failed";
const busyPhase = (phase: Phase) => ["preparing", "running", "cancelling", "uncertain"].includes(phase);
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";

// A transport timeout is not an execution outcome. Keep the handle until Host proves a terminal state.
export function useManualToolCall(api: ManualToolApi, runtime: string) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState("");
  const [trace, setTrace] = useState<CallDiagnostics | null>(null);
  function record(event: CallDiagnosticEvent, code?: unknown) { setTrace(previous => previous ? appendCallDiagnostic(previous, event, code) : null); }
  const generation = useRef(0);
  const active = useRef<{ scope: ManualCallScope; id: string; hostInstanceId?: string } | null>(null);
  const reconciliation = useRef(false);
  const locked = useRef(false);
  const cancelling = useRef(false);
  const checking = useRef(false);
  const awaitingResponse = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    setSupported(null);
    reconciliation.current = false;
    if (!api.callProtocol || !api.prepareCall || !api.cancelCall || !api.callStatus) setSupported(false);
    else void api.callProtocol().then(protocol => {
      if (generation.current === current) {
        reconciliation.current = protocol.schemaVersion === 1 && protocol.profile === manualCallProfile &&
          protocol.reconcileProfile === "manual.tool.reconcile.v1" && typeof api.reconcileCall === "function";
        setSupported(protocol.schemaVersion === 1 && protocol.profile === manualCallProfile &&
          protocol.prepareRequired === true && Array.isArray(protocol.runtimes) && protocol.runtimes.includes(runtime === "javascript" ? "worker" : runtime));
      }
    }).catch(() => { if (generation.current === current) setSupported(false); });
    return () => {
      generation.current++;
      const call = active.current;
      if (locked.current && call) void api.cancelCall?.(call.scope, call.id).catch(() => {});
    };
  }, [api, runtime]);
  function terminal(next: Phase) { locked.current = false; setPhase(next); setNotice(""); }
  async function run(request: ManualCallRequest) {
    if (locked.current || supported === null) throw Object.assign(new Error("Call is busy"), { code: "manual_call_busy" });
    locked.current = true; active.current = null; setNotice(""); setPhase(supported ? "preparing" : "running");
    const current = generation.current;
    setTrace({ schemaVersion: 1, startedAt: Date.now(), events: [] });
    record(supported ? "preparing" : "invoking");
    const { input, catalogRevision, captureResult, ...scope } = request;
    try {
      let callId: string | undefined;
      if (supported) {
        const handle = await api.prepareCall?.(request);
        if (handle?.schemaVersion !== 1 || handle.profile !== manualCallProfile ||
          !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(handle.callId)) throw new Error("Invalid call handle");
        callId = handle.callId;
        if (generation.current !== current) {
          void api.cancelCall?.(scope, callId).catch(() => {});
          throw new Error("Detached call");
        }
        active.current = { scope, id: callId, ...(reconciliation.current &&
          typeof handle.hostInstanceId === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(handle.hostInstanceId)
          ? { hostInstanceId: handle.hostInstanceId } : {}) }; setPhase("running");
        const hostInstanceId = active.current.hostInstanceId;
        setTrace(previous => previous ? { ...previous, callId, ...(hostInstanceId ? { hostInstanceId } : {}) } : null);
        record("handle_issued"); record("invoking");
      }
      awaitingResponse.current = true;
      const response = await api.invoke(scope.sceneId, scope.workspaceId, scope.pluginId, scope.capabilityId,
        input, { catalogRevision, ...(captureResult ? { captureResult: true } : {}), ...(callId ? { callId } : {}) });
      if (generation.current !== current) throw new Error("Detached call");
      record("response_received");
      terminal("completed"); setNotice(""); return response;
    } catch (error) {
      if (generation.current === current) {
        const code = errorCode(error);
        record("request_failed", code);
        // A failed request (including an already-started handle or a proxy's error
        // code) cannot prove this issued call stopped. Only explicit cancellation
        // or a validated status query can release its lock after a lost response.
        if (active.current && code !== "worker_cancelled") {
          setPhase("uncertain"); setNotice(manualCallFailureNotice(code));
        } else { terminal(code === "worker_cancelled" ? "cancelled" : "failed"); }
      }
      throw error;
    } finally { awaitingResponse.current = false; }
  }
  async function cancel() {
    const call = active.current;
    if (!call || !locked.current || cancelling.current) return;
    const current = generation.current;
    cancelling.current = true; setPhase("cancelling"); setNotice("");
    record("cancel_requested");
    try {
      const status = await api.cancelCall?.(call.scope, call.id);
      if (generation.current !== current || !locked.current || active.current !== call) return;
      if (!status || !validCallStatus(status)) throw new Error("Invalid cancel acknowledgement");
      record("cancel_acknowledged", status.outcome ?? undefined);
      // The original invoke owns results; an acknowledgement must never discard a late success.
      setNotice(status.executionFinished ? "The tool has ended. Waiting for its response." : "Cancellation requested. Waiting for the tool to stop.");
    } catch {
      if (generation.current === current && locked.current && active.current === call) {
        setPhase("uncertain"); setNotice("Cancellation could not be confirmed. The tool may still be running.");
        record("cancel_unconfirmed");
      }
    } finally { cancelling.current = false; }
  }
  async function checkStatus() {
    const call = active.current;
    if (!call || !locked.current || checking.current) return;
    const current = generation.current; checking.current = true;
    record("status_requested");
    try {
      const status = await api.callStatus?.(call.scope, call.id).catch(async error => {
        // Only an explicit missing handle permits reconciliation. Offline or malformed
        // responses do not prove absence; the original Host identity must also match.
        if (errorCode(error) !== "manual_call_unavailable" || !call.hostInstanceId || !api.reconcileCall ||
          generation.current !== current || !locked.current || active.current !== call) throw error;
        record("reconciliation_requested");
        const proof = await api.reconcileCall(call.scope, call.id, call.hostInstanceId);
        if (generation.current !== current || active.current !== call) throw new Error("Detached reconciliation");
        if (proof.profile !== "manual.tool.reconcile.v1" || proof.callId !== call.id || proof.hostInstanceId !== call.hostInstanceId ||
          !validCallStatus({ ...proof, profile: manualCallProfile })) throw new Error("Invalid reconciliation proof");
        record("reconciliation_verified", proof.outcome ?? undefined);
        return { ...proof, profile: manualCallProfile };
      });
      if (generation.current !== current || !locked.current || active.current !== call) return;
      if (!status || !validCallStatus(status)) throw new Error("Invalid call status");
      record("status_verified", status.outcome ?? undefined);
      if (status.executionFinished) {
        if (awaitingResponse.current) { setNotice("The tool has ended. Waiting for its response."); return; }
        terminal(status.outcome === "worker_cancelled" ? "cancelled" : "failed");
        setNotice(status.outcome === "worker_cancelled" ? "" : "The tool ended, but its response is unavailable. Check before running it again.");
      } else setNotice("The tool is still running. You can request cancellation again.");
    } catch { if (generation.current === current && locked.current) { record("status_unavailable"); setNotice("Status is unavailable. The tool may still be running."); } }
    finally { checking.current = false; }
  }
  return { supported, phase, notice, trace, busy: busyPhase(phase), run, cancel, checkStatus };
}
