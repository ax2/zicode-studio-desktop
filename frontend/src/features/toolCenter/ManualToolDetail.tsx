import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { ToolAccessScope, ToolAccessStore } from "../commandPalette/tool-access";
import { type ManualTool, type ManualToolApi, type ToolDetail, manualToolError, supportsResultActions } from "./manual-tools";
import { toolFields, prepareToolInput } from "./manual-tool-fields";
import { ManualToolInput } from "./ManualToolInput";
import { ManualToolInformation } from "./ManualToolInformation";
import type { CapturedToolResponse } from "../../../../public/native/plugins/plugin-result-actions.js";
import { ManualToolResultActions } from "./ManualToolResultActions";
import { ManualToolResultView } from "./ManualToolResultView";
import { type ManualToolResult, manualToolResult } from "./manual-tool-result";
import { useManualToolCall } from "./use-manual-tool-call";
import { ResourceToolRunner, type ResourceTargetProvider, type ReceiveNoteDraft } from "./ResourceToolRunner";
import type { ResourceSessionOwner } from "./resource-session-owner";
import { ToolCallDiagnostics } from "./ToolCallDiagnostics";
import { dataTransformPreview, isDataTransform, type TransformPreview } from "./data-transform-result";
import { prepareTransformApply, type TransformInput } from "./data-transform-apply";
import { readManualToolFile, tableFileFormats, type ToolFileTarget } from "./manual-tool-file";

const hostResourceReceivers = new Map([
  ["com.zicode.resource-inspector/image.inspect", "resource.host.image-input.v1"],
  ["com.zicode.ocr/ocr.resource-text", "resource.host.ocr-input.v1"],
  ["com.zicode.text-inspector/text.inspect", "resource.host.text-input.v1"],
]);

const diffFileTargets = [
  { target: "diff-left", field: "left", label: "Import left text file…", inputLabel: "Left text file", fieldLabel: "Original text" },
  { target: "diff-right", field: "right", label: "Import right text file…", inputLabel: "Right text file", fieldLabel: "Revised text" },
] as const;

export interface ManualToolDetailProps {
  tool: ManualTool; revision: string; api: ManualToolApi; scope: ToolAccessScope;
  accessStore?: ToolAccessStore; onOpenApplication?: () => void;
  onBusy?(running: boolean): void;
  onRecentChange?(): void;
  getResourceTarget?: ResourceTargetProvider;
  receiveNoteDraft?: ReceiveNoteDraft;
  resourceSession?: ResourceSessionOwner;
  onReload?(): Promise<void>;
}

interface ToolDraft {
  values: Record<string, string>;
  undo?: { identity: string; values: Record<string, string>; kind: "apply" | "import" };
}

interface TransformExecution {
  identity: string;
  sequence: number;
  api: ManualToolApi;
  source: Record<string, string>;
  preview: TransformPreview;
  next: TransformInput | null;
}

export function ManualToolDetail(props: ManualToolDetailProps) {
  const call = useManualToolCall(props.api, props.tool.runtime);
  return <ManualToolDetailView {...props} call={call} />;
}

export function ManualToolDetailView({ tool, revision, api, scope, accessStore, onOpenApplication, onBusy, onRecentChange, getResourceTarget, receiveNoteDraft, resourceSession, onReload, call }: ManualToolDetailProps & {
  call: ReturnType<typeof useManualToolCall>;
}) {
  const [detail, setDetail] = useState<ToolDetail | null>(null);
  const detailId = useId();
  const [{ values, undo }, setDraft] = useState<ToolDraft>({ values: {} });
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [invalidField, setInvalidField] = useState("");
  const [recording, setRecording] = useState(false);
  const running = call.busy || recording;
  const [result, setResult] = useState<ManualToolResult | null>(null);
  const [transformed, setTransformed] = useState<TransformExecution | null>(null);
  const executionSequence = useRef(0);
  const [captured, setCaptured] = useState<CapturedToolResponse | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [fileLoading, setFileLoading] = useState<ToolFileTarget | null>(null);
  const editingLocked = running || actionBusy || fileLoading !== null;
  const fileRead = useRef<{ identity: string; api: ManualToolApi; sequence: number } | null>(null);
  const alive = useRef(true);
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  function jumpTo(element: HTMLElement | null) {
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "start" });
  }
  const busyCallback = useRef(onBusy);
  busyCallback.current = onBusy;
  useEffect(() => { busyCallback.current?.(editingLocked || resourceBusy); }, [editingLocked, resourceBusy]);
  useEffect(() => {
    if (!editingLocked && !resourceBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editingLocked, resourceBusy]);
  useEffect(() => {
    alive.current = true;
    void api.loadTool(scope.sceneId, { pluginId: tool.pluginId, capabilityId: tool.capabilityId, revision })
      .then(value => { if (alive.current) setDetail(value); })
      .catch(reason => { if (alive.current) { setError(manualToolError(reason)); setStale(isStaleToolError(reason)); } });
    return () => { alive.current = false; };
  }, [api, scope.sceneId, tool.pluginId, tool.capabilityId, revision]);
  const fields = detail ? toolFields(detail.capability.inputSchema) : null;
  const permissionNeeded = detail?.permissions.some(permission => permission.required && permission.name !== "pi.tools.register");
  const supported = detail && fields && tool.runtime !== "builtin" && !permissionNeeded;
  const hostResourceProfile = hostResourceReceivers.get(`${tool.pluginId}/${tool.capabilityId}`);
  const resourceTool = (detail?.resourceInputProfile === "resource.wasi.input.draft2" && tool.runtime === "wasi") ||
    (tool.runtime === "builtin" && hostResourceProfile !== undefined && detail?.resourceInputProfile === hostResourceProfile);
  const dataTransform = isDataTransform(tool);
  const computePlugin = tool.pluginId === "com.zicode.devtools.compute";
  const tableMerge = computePlugin &&
    ["left", "inner", "append", "columns"].some(mode => tool.capabilityId === `devtools.compute.merge.${mode}`);
  const tableWorkbench = computePlugin &&
    ["json", "csv", "query"].some(mode => tool.capabilityId === `devtools.compute.table.${mode}`);
  const qualityFormat = computePlugin
    ? tableFileFormats.find(format => tool.capabilityId === "devtools.compute.quality." + format)
    : undefined;
  const comparePlugin = tool.pluginId === "com.zicode.devtools.compare";
  const jsonPath = comparePlugin && tool.capabilityId === "devtools.compare.json.path";
  const textDiff = comparePlugin && tool.capabilityId === "devtools.compare.text.diff";
  const singleTableTarget = dataTransform ? "transform" : tableWorkbench ? "workbench" : qualityFormat;
  const singleFileTarget = jsonPath ? "json-path" : singleTableTarget;
  const transformIdentity = JSON.stringify([scope.sceneId, scope.workspaceId, tool.pluginId, tool.capabilityId, revision]);
  useLayoutEffect(() => {
    fileRead.current = { identity: transformIdentity, api, sequence: 0 };
    setFileLoading(null);
    return () => { fileRead.current = null; };
  }, [transformIdentity, api]);
  const ownsUndo = undo?.identity === transformIdentity;
  const inputsCurrent = transformed?.identity === transformIdentity && transformed.api === api && transformed.source === values;
  const applyAllowed = inputsCurrent && supported && !resourceTool && tool.enabled && detail?.enabled && !editingLocked;
  const alreadyCurrent = inputsCurrent && transformed?.next?.text === values.text &&
    transformed?.next?.options === values.options;
  const canApply = applyAllowed && Boolean(transformed?.next) && !alreadyCurrent;
  const applied = ownsUndo && undo?.kind === "apply" && undo.values === transformed?.source;
  function applyTransform() {
    if (!canApply || !transformed || transformed.sequence !== executionSequence.current) return;
    const { next, source } = transformed;
    if (!next) return;
    setDraft(current => current.values === source
      ? { values: { ...source, ...next }, undo: { identity: transformIdentity, values: source, kind: "apply" } }
      : current);
  }

  function undoDraft() {
    if (!ownsUndo || editingLocked) return;
    setDraft(current => undo && current.undo === undo ? { values: undo.values } : current);
  }

  async function importFile(file: File, target: ToolFileTarget) {
    const owner = fileRead.current;
    const allowed = target === singleFileTarget || (tableMerge && (target === "left" || target === "right")) ||
      (textDiff && diffFileTargets.some(side => side.target === target));
    if (!owner || owner.identity !== transformIdentity || owner.api !== api ||
        !allowed || !supported || !detail.enabled || editingLocked) return;
    const sequence = ++owner.sequence;
    const isCurrent = () => fileRead.current === owner && owner.sequence === sequence;
    setFileLoading(target);
    setError("");
    try {
      const next = await readManualToolFile(file, values, target);
      if (!isCurrent()) return;
      setInvalidField("");
      setDraft(current => current.values === values
        ? { values: { ...values, ...next }, undo: { identity: transformIdentity, values, kind: "import" } }
        : current);
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message :
        textDiff ? "Could not read the text file." : jsonPath ? "Could not read the JSON file." : "Could not read the table file.");
    } finally {
      if (isCurrent()) setFileLoading(null);
    }
  }

  async function execute() {
    if (!supported || editingLocked || !detail?.enabled || call.supported === null) return;
    const prepared = prepareToolInput(fields, values);
    const sequence = ++executionSequence.current;
    setError(""); setStale(false); setInvalidField(""); setResult(null); setCaptured(null); setTransformed(null);
    if ("error" in prepared) {
      setError(prepared.error); setInvalidField(prepared.field);
      document.getElementById(`${detailId}-${prepared.field}`)?.focus();
      return;
    }
    setRecording(true); setError(""); setResult(null); setCaptured(null);
    try {
      const response = await call.run({ ...scope, pluginId: tool.pluginId, capabilityId: tool.capabilityId,
        input: prepared.input, catalogRevision: detail.revision, ...(supportsResultActions(api) ? { captureResult: true } : {}) });
      if (!alive.current || sequence !== executionSequence.current) return;
      const outcome = manualToolResult(response.result);
      if (dataTransform && outcome.successful) {
        const preview = dataTransformPreview(outcome.text);
        if (preview) {
          const wire = response.result;
          const declared = wire !== null && typeof wire === "object" && "contractVersion" in wire &&
            wire.contractVersion === "1.0.0-rc.1";
          const input = declared ? prepareTransformApply(tool.capabilityId, values, preview) : null;
          const next = input && !("error" in prepareToolInput(fields, { ...values, ...input })) ? input : null;
          setTransformed({ identity: transformIdentity, sequence, api, source: values, preview, next });
        }
      }
      setResult(outcome);
      if (outcome.successful) setCaptured(response);
      if (outcome.successful && accessStore) {
        try { await accessStore.mutate(scope, { kind: "recentRecord", id: tool.accessId }); onRecentChange?.(); }
        catch { if (alive.current) setError("Tool completed, but history could not be saved."); }
      }
    } catch (reason) {
      if (alive.current && !(reason && typeof reason === "object" && "code" in reason && reason.code === "worker_cancelled")) {
        setError(manualToolError(reason)); setStale(isStaleToolError(reason));
      }
    }
    finally { if (alive.current) setRecording(false); }
  }
  return <section className="ui-card tool-detail" aria-labelledby={`${detailId}-title`} aria-busy={running || resourceBusy || fileLoading !== null}>
    <h2 id={`${detailId}-title`}>{tool.title}</h2>
    <ManualToolInformation tool={tool} detail={detail} busy={editingLocked || resourceBusy} onOpenApplication={detail && !resourceTool && !supported ? undefined : onOpenApplication} />
    {!detail && !error && <p role="status">{t("Loading tool details…")}</p>}
    {error && !call.notice && call.phase !== "cancelled" && <p role="alert">{t(error)}</p>}
    {stale && onReload && <button type="button" className="ui-button ui-button--secondary"
      disabled={editingLocked || resourceBusy || reloading} onClick={() => {
        setReloading(true);
        void onReload().catch(reason => { if (alive.current) setError(manualToolError(reason)); })
          .finally(() => { if (alive.current) setReloading(false); });
      }}>{t(reloading ? "Reloading tool details…" : "Reload tool details")}</button>}
    {call.phase === "cancelled" && <p role="status">{t("Tool cancelled. No result was kept.")}</p>}
    {call.notice && <p role="status" key={call.notice}>{t(call.notice)}</p>}
    {detail && <>
      {!detail.enabled && <p role="status">{t("Plugin is disabled")}</p>}
      {!detail.enabled && <p>{t("Enable this plugin in Plugin Manager before running its tools.")}</p>}
      {resourceTool ? <ResourceToolRunner tool={tool} detail={detail} api={api} getTarget={getResourceTarget} scope={scope}
        accessStore={accessStore} onBusy={setResourceBusy} onRecentChange={onRecentChange} session={resourceSession} receiveNoteDraft={receiveNoteDraft} /> : supported ? <form ref={formRef} tabIndex={-1} aria-label={t("Tool inputs")} onSubmit={event => { event.preventDefault(); void execute(); }}>
        {fields.map(field => {
          const side = textDiff ? diffFileTargets.find(target => target.field === field.key) : undefined;
          return <ManualToolInput key={field.key} id={`${detailId}-${field.key}`}
            field={side ? { ...field, label: t(side.fieldLabel) } : field} value={values[field.key]}
            disabled={editingLocked} invalid={invalidField === field.key}
            onOmit={() => { setDraft(previous => { const next = { ...previous.values }; delete next[field.key]; return { values: next }; });
              if (invalidField === field.key) { setInvalidField(""); setError(""); } }}
            onChange={value => setDraft(previous => ({ values: { ...previous.values, [field.key]: value } }))} />;
        })}
        <div className="ui-toolbar">
          <button type="submit" className="ui-button ui-button--primary" disabled={editingLocked || !detail.enabled || call.supported === null}>
            <span key={running ? call.phase : "idle"}>{t(running ? call.phase === "preparing" ? "Preparing tool…" : "Running…" : "Execute tool")}</span>
          </button>
          {singleFileTarget && <FileImportButton key={transformIdentity}
            label={t(jsonPath ? "Import JSON file…" : "Import table file…")}
            inputLabel={t(jsonPath ? "JSON input file" : "Table file")}
            accept={jsonPath ? ".json" : qualityFormat && "." + qualityFormat}
            loadingLabel={jsonPath ? "Reading JSON file…" : undefined}
            disabled={editingLocked || !detail.enabled} loading={fileLoading === singleFileTarget}
            onPick={file => { void importFile(file, singleFileTarget); }} />}
          {textDiff && diffFileTargets.map(side => <FileImportButton key={side.target + ":" + transformIdentity}
            label={t(side.label)} inputLabel={t(side.inputLabel)} accept="" loadingLabel="Reading text file…"
            disabled={editingLocked || !detail.enabled} loading={fileLoading === side.target}
            onPick={file => { void importFile(file, side.target); }} />)}
          {tableMerge && <>
            <FileImportButton key={"left:" + transformIdentity} label={t("Import left table…")}
              inputLabel={t("Left table file")} disabled={editingLocked || !detail.enabled} loading={fileLoading === "left"}
              onPick={file => { void importFile(file, "left"); }} />
            <FileImportButton key={"right:" + transformIdentity} label={t("Import right table…")}
              inputLabel={t("Right table file")} disabled={editingLocked || !detail.enabled} loading={fileLoading === "right"}
              onPick={file => { void importFile(file, "right"); }} />
          </>}
          {ownsUndo && <button type="button" className="ui-button ui-button--secondary" disabled={editingLocked}
            onClick={undoDraft}>{t(undo?.kind === "import" ? "Undo last import" : "Undo last application")}</button>}
          {result !== null && <button type="button" className="ui-button ui-button--secondary" onClick={() => jumpTo(resultRef.current)}>{t("View latest execution")}</button>}
          {call.supported && call.busy && <button type="button" className="ui-button ui-button--danger"
            disabled={call.phase === "preparing" || call.phase === "cancelling"} onClick={() => { void call.cancel(); }}>
            <span key={call.phase}>{t(call.phase === "cancelling" ? "Cancelling…" : "Cancel tool")}</span>
          </button>}
          {call.phase === "uncertain" && <button type="button" className="ui-button ui-button--secondary" onClick={() => { void call.checkStatus(); }}>{t("Check tool status")}</button>}
        </div>
        {running && <p className="tool-center-source">{t("Switching pages keeps this tool running. Return here to check or cancel it before closing the window.")}</p>}
      </form> : detail.enabled && <div className="tool-interface-entry">
        <p>{t(onOpenApplication ? "Use the tool interface to continue." : "This tool needs its application UI or additional Host support. The generic form cannot run it.")}</p>
        {onOpenApplication && <button type="button" className="ui-button ui-button--primary"
          disabled={running || actionBusy || resourceBusy} onClick={onOpenApplication}>{t("Open tool interface")}</button>}
      </div>}
    </>}
    {result !== null && <ManualToolResultView result={result} dataTransform={dataTransform}
      transformPreview={dataTransform ? transformed?.preview ?? null : undefined}
      transformActions={transformed && <div className="ui-toolbar">
        {applied
          ? <span role="status">{t("Applied to the input as a JSON table.")}</span>
          : alreadyCurrent ? <span role="status">{t("The result already matches the input.")}</span>
            : <>
            <button type="button" className="ui-button ui-button--secondary" disabled={!canApply}
              onClick={applyTransform}>{t("Apply to input")}</button>
            {!inputsCurrent
              ? <span className="tool-center-source">{t("The inputs changed. Run the tool again to apply a current result.")}</span>
              : !transformed.next && <span className="tool-center-source">{t("This result cannot be applied within the tool’s input contract.")}</span>}
          </>}
      </div>}
      sectionRef={resultRef} onBackToInputs={supported ? () => jumpTo(formRef.current) : undefined} />}
    {captured && supportsResultActions(api) && <ManualToolResultActions response={captured}
      accessStore={accessStore} onRecentChange={onRecentChange}
      scope={{ ...scope, pluginId: tool.pluginId, capabilityId: tool.capabilityId }} gateway={api}
      onBusy={setActionBusy} />}
    <ToolCallDiagnostics trace={call.trace} tool={tool} />
  </section>;
}

function FileImportButton({ label, inputLabel, disabled, loading, accept = ".csv,.tsv,.json", loadingLabel = "Reading table file…", onPick }: {
  label: string; inputLabel: string; disabled: boolean; loading: boolean; accept?: string; loadingLabel?: string; onPick(file: File): void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  return <>
    <input ref={picker} type="file" hidden accept={accept} aria-label={inputLabel} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file) onPick(file);
    }} />
    <button type="button" className="ui-button ui-button--secondary" disabled={disabled}
      onClick={() => picker.current?.click()}>{loading ? t(loadingLabel) : label}</button>
  </>;
}

function isStaleToolError(reason: unknown): boolean {
  return Boolean(reason && typeof reason === "object" && "code" in reason &&
    (reason.code === "catalog_changed" || reason.code === "capability_changed"));
}
