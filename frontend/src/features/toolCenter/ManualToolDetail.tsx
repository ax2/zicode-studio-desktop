import { useEffect, useId, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { ToolAccessScope, ToolAccessStore } from "../commandPalette/tool-access";
import { type ManualTool, type ManualToolApi, type ToolDetail, manualToolError, supportsResultActions } from "./manual-tools";
import { toolFields, prepareToolInput } from "./manual-tool-fields";
import { ManualToolInput } from "./ManualToolInput";
import type { CapturedToolResponse } from "../../../../public/native/plugins/plugin-result-actions.js";
import { ManualToolResultActions } from "./ManualToolResultActions";
import { ManualToolResultView } from "./ManualToolResultView";
import { type ManualToolResult, manualToolResult } from "./manual-tool-result";
import { useManualToolCall } from "./use-manual-tool-call";
import { ResourceToolRunner, type ResourceTargetProvider } from "./ResourceToolRunner";
import type { ResourceSessionOwner } from "./resource-session-owner";
import { ToolCallDiagnostics } from "./ToolCallDiagnostics";

export interface ManualToolDetailProps {
  tool: ManualTool; revision: string; api: ManualToolApi; scope: ToolAccessScope;
  accessStore?: ToolAccessStore; onOpenApplication?: () => void;
  onBusy?(running: boolean): void;
  onRecentChange?(): void;
  getResourceTarget?: ResourceTargetProvider;
  resourceSession?: ResourceSessionOwner;
}

export function ManualToolDetail(props: ManualToolDetailProps) {
  const call = useManualToolCall(props.api, props.tool.runtime);
  return <ManualToolDetailView {...props} call={call} />;
}

export function ManualToolDetailView({ tool, revision, api, scope, accessStore, onOpenApplication, onBusy, onRecentChange, getResourceTarget, resourceSession, call }: ManualToolDetailProps & {
  call: ReturnType<typeof useManualToolCall>;
}) {
  const [detail, setDetail] = useState<ToolDetail | null>(null);
  const detailId = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState("");
  const [recording, setRecording] = useState(false);
  const running = call.busy || recording;
  const [result, setResult] = useState<ManualToolResult | null>(null);
  const [captured, setCaptured] = useState<CapturedToolResponse | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [resourceBusy, setResourceBusy] = useState(false);
  const alive = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  function jumpTo(element: HTMLElement | null) {
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "start" });
  }
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  useEffect(() => { busyCallback.current?.(running || actionBusy || resourceBusy); }, [running, actionBusy, resourceBusy]);
  useEffect(() => {
    if (!running && !actionBusy && !resourceBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, actionBusy, resourceBusy]);
  useEffect(() => {
    alive.current = true;
    void api.loadTool(scope.sceneId, { pluginId: tool.pluginId, capabilityId: tool.capabilityId, revision })
      .then(value => { if (alive.current) setDetail(value); })
      .catch(reason => { if (alive.current) setError(manualToolError(reason)); });
    return () => { alive.current = false; };
  }, [api, scope.sceneId, tool.pluginId, tool.capabilityId, revision]);
  const fields = detail ? toolFields(detail.capability.inputSchema) : null;
  const permissionNeeded = detail?.permissions.some(permission => permission.required && permission.name !== "pi.tools.register");
  const supported = detail && fields && tool.runtime !== "builtin" && !permissionNeeded;
  const resourceTool = detail?.resourceInputProfile === "resource.wasi.input.draft2" && tool.runtime === "wasi";
  async function execute() {
    if (!supported || running || actionBusy || !detail?.enabled || call.supported === null) return;
    const prepared = prepareToolInput(fields, values);
    setError(""); setInvalidField(""); setResult(null); setCaptured(null);
    if ("error" in prepared) {
      setError(prepared.error); setInvalidField(prepared.field);
      document.getElementById(`${detailId}-${prepared.field}`)?.focus();
      return;
    }
    setRecording(true); setError(""); setResult(null); setCaptured(null);
    try {
      const response = await call.run({ ...scope, pluginId: tool.pluginId, capabilityId: tool.capabilityId,
        input: prepared.input, catalogRevision: detail.revision, ...(supportsResultActions(api) ? { captureResult: true } : {}) });
      if (!alive.current) return;
      const outcome = manualToolResult(response.result);
      setResult(outcome);
      if (outcome.successful) setCaptured(response);
      if (outcome.successful && accessStore) {
        try { await accessStore.mutate(scope, { kind: "recentRecord", id: tool.accessId }); onRecentChange?.(); }
        catch { if (alive.current) setError("Tool completed, but history could not be saved."); }
      }
    } catch (reason) {
      if (alive.current && !(reason && typeof reason === "object" && "code" in reason && reason.code === "worker_cancelled")) setError(manualToolError(reason));
    }
    finally { if (alive.current) setRecording(false); }
  }
  return <section className="ui-card tool-detail" aria-labelledby={`${detailId}-title`} aria-busy={running || resourceBusy}>
    <h2 id={`${detailId}-title`}>{tool.title}</h2>
    <p className="tool-center-source">{tool.applicationName} · {tool.version}</p>
    {!detail && !error && <p role="status">{t("Loading tool details…")}</p>}
    {error && !call.notice && call.phase !== "cancelled" && <p role="alert">{t(error)}</p>}
    {call.phase === "cancelled" && <p role="status">{t("Tool cancelled. No result was kept.")}</p>}
    {call.notice && <p role="status" key={call.notice}>{t(call.notice)}</p>}
    {detail && <>
      {!detail.enabled && <p role="status">{t("Plugin is disabled")}</p>}
      {detail.permissions.length > 0 && <details><summary>{t("Declared permissions")}</summary>
        {detail.permissions.map(permission => <p key={permission.name}>{permission.name} · {t(permission.granted ? "Granted" : "Not granted")} — {permission.reason}</p>)}
      </details>}
      {resourceTool ? <ResourceToolRunner tool={tool} detail={detail} api={api} getTarget={getResourceTarget} scope={scope}
        accessStore={accessStore} onBusy={setResourceBusy} onRecentChange={onRecentChange} session={resourceSession} /> : supported ? <form ref={formRef} tabIndex={-1} aria-label={t("Tool inputs")} onSubmit={event => { event.preventDefault(); void execute(); }}>
        {result !== null && <button type="button" className="ui-button ui-button--secondary" onClick={() => jumpTo(resultRef.current)}>{t("View latest execution")}</button>}
        {fields.map(field => <ManualToolInput key={field.key} id={`${detailId}-${field.key}`} field={field} value={values[field.key]}
          disabled={running || actionBusy} invalid={invalidField === field.key}
          onChange={value => setValues(previous => ({ ...previous, [field.key]: value }))} />)}
        <p className="tool-center-source">{t("Switching pages keeps this tool running. Return here to check or cancel it before closing the window.")}</p>
        <div className="ui-toolbar">
          <button type="submit" className="ui-button ui-button--primary" disabled={running || actionBusy || !detail.enabled || call.supported === null}>
            <span key={running ? call.phase : "idle"}>{t(running ? call.phase === "preparing" ? "Preparing tool…" : "Running…" : "Execute tool")}</span>
          </button>
          {call.supported && call.busy && <button type="button" className="ui-button ui-button--danger"
            disabled={call.phase === "preparing" || call.phase === "cancelling"} onClick={() => { void call.cancel(); }}>
            <span key={call.phase}>{t(call.phase === "cancelling" ? "Cancelling…" : "Cancel tool")}</span>
          </button>}
          {call.phase === "uncertain" && <button type="button" className="ui-button ui-button--secondary" onClick={() => { void call.checkStatus(); }}>{t("Check tool status")}</button>}
        </div>
      </form> : <p>{t("This tool needs its application UI or additional Host support. The generic form cannot run it.")}</p>}
    </>}
    {onOpenApplication && <button type="button" className="ui-button ui-button--secondary" disabled={running || actionBusy || resourceBusy} onClick={onOpenApplication}>{t("Open application")}</button>}
    {result !== null && <ManualToolResultView result={result} sectionRef={resultRef} onBackToInputs={supported ? () => jumpTo(formRef.current) : undefined} />}
    {captured && supportsResultActions(api) && <ManualToolResultActions response={captured}
      accessStore={accessStore} onRecentChange={onRecentChange}
      scope={{ ...scope, pluginId: tool.pluginId, capabilityId: tool.capabilityId }} gateway={api}
      onBusy={setActionBusy} />}
    <ToolCallDiagnostics trace={call.trace} tool={tool} />
  </section>;
}
