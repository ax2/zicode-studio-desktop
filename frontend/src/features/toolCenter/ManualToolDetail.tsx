import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { FileImportButton } from "./FileImportButton";
import { WorkbenchDraftFileActions } from "./WorkbenchDraftFileActions";
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
import { dataMergePreview, dataTransformPreview, isDataTransform, type MergePreview, type TransformPreview } from "./data-transform-result";
import { prepareTransformApply, type TransformInput } from "./data-transform-apply";
import { MergeResultActions } from "./MergeResultActions";
import { WorkbenchDraftHandoff } from "./WorkbenchDraftHandoff";
import type { OpenWorkbenchDraft } from "./workbench-draft-handoff";
import { isWorkbenchDraftTool, snapshotWorkbenchDraft, type WorkbenchDraftReader } from "./workbench-session-draft";
import { prepareWorkbenchApply, type WorkbenchDraft } from "./data-workbench-apply";
import { prepareMergeApply, type MergeSide } from "./data-merge-apply";
import { readManualToolFile, tableFileFormats, type ToolFileTarget } from "./manual-tool-file";

const hostResourceReceivers = new Map([
  ["com.zicode.resource-inspector/image.inspect", "resource.host.image-input.v1"],
  ["com.zicode.ocr/ocr.resource-text", "resource.host.ocr-input.v1"],
  ["com.zicode.text-inspector/text.inspect", "resource.host.text-input.v1"],
]);

const textDiffFileTargets = [
  { target: "diff-left", field: "left", label: "Import left text file…", inputLabel: "Left text file", fieldLabel: "Original text" },
  { target: "diff-right", field: "right", label: "Import right text file…", inputLabel: "Right text file", fieldLabel: "Revised text" },
] as const;

const jsonDiffFileTargets = [
  { target: "json-diff-left", field: "left", label: "Import left JSON file…", inputLabel: "Left JSON file", fieldLabel: "Original JSON" },
  { target: "json-diff-right", field: "right", label: "Import right JSON file…", inputLabel: "Right JSON file", fieldLabel: "Revised JSON" },
] as const;

const jsonSchemaFileTargets = [
  { target: "schema-instance", field: "instance", label: "Import JSON instance…", inputLabel: "JSON instance file", fieldLabel: "JSON instance" },
  { target: "schema-root", field: "schema", label: "Import JSON Schema…", inputLabel: "JSON Schema file", fieldLabel: "Root JSON Schema" },
] as const;

const sqlFileTargets = [
  { target: "sql-format", field: "text", label: "Import SQL file…", inputLabel: "SQL file", fieldLabel: "SQL text" },
] as const;

const independentMergeLabels = new Map([
  ["left", "Left table"], ["right", "Right table"],
  ["leftFormat", "Left table format"], ["rightFormat", "Right table format"],
  ["leftKey", "Left join column"], ["rightKey", "Right join column"],
]);

export interface ManualToolDetailProps {
  tool: ManualTool; revision: string; api: ManualToolApi; scope: ToolAccessScope;
  accessStore?: ToolAccessStore; onOpenApplication?: () => void;
  onBusy?(running: boolean): void;
  onRecentChange?(): void;
  getResourceTarget?: ResourceTargetProvider;
  receiveNoteDraft?: ReceiveNoteDraft;
  resourceSession?: ResourceSessionOwner;
  onReload?(): Promise<void>;
  initialDraft?: Record<string, string>;
  workbenchDraftActive?: boolean;
  draftReaderRef?(reader: WorkbenchDraftReader | null): void;
  onOpenWorkbenchDraft?: OpenWorkbenchDraft;
}

interface ToolDraft {
  values: Record<string, string>;
  undo?: { identity: string; values: Record<string, string>; kind: "apply" | "import"; mergeSide?: MergeSide; scopeBound?: boolean };
}

interface DraftExecution {
  identity: string;
  sequence: number;
  api: ManualToolApi;
  source: Record<string, string>;
}

type TableExecution = DraftExecution & (
  | { kind: "transform"; preview: TransformPreview; next: TransformInput | null }
  | { kind: "workbench"; next: WorkbenchDraft | null }
  | { kind: "merge"; preview: MergePreview; next: Record<MergeSide, Record<string, string> | null> }
);

export function ManualToolDetail(props: ManualToolDetailProps) {
  const call = useManualToolCall(props.api, props.tool.runtime);
  return <ManualToolDetailView {...props} call={call} />;
}

export function ManualToolDetailView({ tool, revision, api, scope, accessStore, onOpenApplication, onBusy, onRecentChange, getResourceTarget, receiveNoteDraft, resourceSession, onReload, initialDraft, draftReaderRef, onOpenWorkbenchDraft, workbenchDraftActive = true, call }: ManualToolDetailProps & {
  call: ReturnType<typeof useManualToolCall>;
}) {
  const detailOwner = useMemo(() => ({ api, sceneId: scope.sceneId, pluginId: tool.pluginId, capabilityId: tool.capabilityId, revision }),
    [api, scope.sceneId, tool.pluginId, tool.capabilityId, revision]);
  const [loadedDetail, setLoadedDetail] = useState<{ owner: typeof detailOwner; value: ToolDetail } | null>(null);
  const detail = loadedDetail?.owner === detailOwner ? loadedDetail.value : null;
  const detailId = useId();
  const [{ values, undo }, setDraft] = useState<ToolDraft>(() => ({ values: initialDraft ?? {} }));
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [invalidField, setInvalidField] = useState("");
  const [recording, setRecording] = useState(false);
  const running = call.busy || recording;
  const [result, setResult] = useState<ManualToolResult | null>(null);
  const [tableExecution, setTableExecution] = useState<TableExecution | null>(null);
  const transformed = tableExecution?.kind === "transform" ? tableExecution : null;
  const merged = tableExecution?.kind === "merge" ? tableExecution : null;
  const singleDraft = tableExecution?.kind === "workbench" ? tableExecution : transformed;
  const executionSequence = useRef(0);
  const [captured, setCaptured] = useState<CapturedToolResponse | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [fileLoading, setFileLoading] = useState<ToolFileTarget | null>(null);
  const editingLocked = running || actionBusy || fileLoading !== null;
  const draftOwner = useRef<{ identity: string; api: ManualToolApi; sequence: number } | null>(null);
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
    let loadingCurrentDetail = true;
    alive.current = true;
    const { api, sceneId, ...request } = detailOwner;
    void api.loadTool(sceneId, request)
      .then(value => { if (loadingCurrentDetail) setLoadedDetail({ owner: detailOwner, value }); })
      .catch(reason => { if (loadingCurrentDetail) { setError(manualToolError(reason)); setStale(isStaleToolError(reason)); } });
    return () => { loadingCurrentDetail = false; alive.current = false; };
  }, [detailOwner]);
  const fields = detail ? toolFields(detail.capability.inputSchema) : null;
  const permissionNeeded = detail?.permissions.some(permission => permission.required && permission.name !== "pi.tools.register");
  const supported = detail && fields && tool.runtime !== "builtin" && !permissionNeeded;
  useEffect(() => { if (initialDraft && supported) formRef.current?.focus({ preventScroll: true }); }, [initialDraft, supported]);
  const hostResourceProfile = hostResourceReceivers.get(`${tool.pluginId}/${tool.capabilityId}`);
  const resourceTool = (detail?.resourceInputProfile === "resource.wasi.input.draft2" && tool.runtime === "wasi") ||
    (tool.runtime === "builtin" && hostResourceProfile !== undefined && detail?.resourceInputProfile === hostResourceProfile);
  const dataTransform = isDataTransform(tool);
  const computePlugin = tool.pluginId === "com.zicode.devtools.compute";
  const legacyMerge = computePlugin && /^devtools\.compute\.merge\.(left|inner|append|columns)$/.test(tool.capabilityId);
  const independentMerge = tool.pluginId === "com.zicode.devtools.table-merge" &&
    /^devtools\.table-merge\.(left|inner|append|columns)$/.test(tool.capabilityId);
  const tableMerge = legacyMerge || independentMerge;
  const leftMergeTarget = independentMerge ? "merge-left" : "left";
  const rightMergeTarget = independentMerge ? "merge-right" : "right";
  const tableWorkbench = computePlugin &&
    ["json", "csv", "query"].some(mode => tool.capabilityId === `devtools.compute.table.${mode}`);
  const workbenchApply = isWorkbenchDraftTool(tool) && detail?.version === tool.version;
  const readableDraft = useRef<Record<string, string> | null>(null);
  const activeWorkbench = workbenchApply && detail?.enabled && detail.revision === revision &&
    detail.pluginId === tool.pluginId && detail.capability.id === tool.capabilityId && supported && !resourceTool;
  const canReadDraft = activeWorkbench && !editingLocked;
  const draftFileTool = activeWorkbench && fields?.length === 2 &&
    fields.every(field => field.kind === "string" && !field.choices && (field.key === "text" || field.key === "options"));
  useLayoutEffect(() => { readableDraft.current = canReadDraft ? values : null; }, [canReadDraft, values]);
  useLayoutEffect(() => {
    if (!draftReaderRef) return;
    draftReaderRef(() => readableDraft.current && snapshotWorkbenchDraft(readableDraft.current));
    return () => draftReaderRef(null);
  }, [draftReaderRef]);
  const qualityFormat = computePlugin
    ? tableFileFormats.find(format => tool.capabilityId === "devtools.compute.quality." + format)
    : undefined;
  const comparePlugin = tool.pluginId === "com.zicode.devtools.compare";
  const jsonPath = comparePlugin && tool.capabilityId === "devtools.compare.json.path";
  const textDiff = comparePlugin && tool.capabilityId === "devtools.compare.text.diff";
  const jsonDiff = comparePlugin && /^devtools\.compare\.json\.diff\.(ordered|unordered)$/.test(tool.capabilityId);
  const jsonSchema = tool.pluginId === "com.zicode.devtools.json-schema" && tool.capabilityId === "devtools.json-schema.validate";
  const sqlFormat = tool.pluginId === "com.zicode.devtools.text" && tool.capabilityId === "devtools.text.sql.format" &&
    tool.version === "0.4.1" && tool.runtime === "wasi" && detail?.enabled && detail.version === tool.version &&
    fields?.some(field => field.key === "text" && field.kind === "string" && field.maxLength === 8192);
  const documentFileTargets = textDiff ? textDiffFileTargets : jsonDiff ? jsonDiffFileTargets :
    jsonSchema ? jsonSchemaFileTargets : sqlFormat ? sqlFileTargets : [];
  const jsonDocument = jsonPath || jsonDiff || jsonSchema;
  const singleTableTarget = dataTransform ? "transform" : tableWorkbench ? "workbench" : qualityFormat;
  const singleFileTarget = jsonPath ? "json-path" : singleTableTarget;
  const transformIdentity = JSON.stringify([scope.sceneId, scope.workspaceId, tool.pluginId, tool.capabilityId, revision]);
  useLayoutEffect(() => {
    draftOwner.current = { identity: transformIdentity, api, sequence: 0 };
    setFileLoading(null);
    setRecording(false);
    setTableExecution(current => current?.kind === "transform" ? current : null);
    setDraft(current => current.undo?.scopeBound ? { values: current.values } : current);
    return () => { draftOwner.current = null; };
  }, [transformIdentity, api]);
  const ownsUndo = undo?.identity === transformIdentity;
  const inputsCurrent = tableExecution?.identity === transformIdentity &&
    tableExecution.sequence === executionSequence.current && tableExecution.api === api && tableExecution.source === values;
  const applyAllowed = inputsCurrent && supported && !resourceTool && tool.enabled && detail?.enabled && !editingLocked;
  const alreadyCurrent = inputsCurrent && singleDraft?.next?.text === values.text &&
    singleDraft?.next?.options === values.options;
  const canApply = applyAllowed && Boolean(singleDraft?.next) && !alreadyCurrent &&
    (singleDraft?.kind !== "workbench" || workbenchApply);
  const applied = ownsUndo && undo?.kind === "apply" && undo.values === tableExecution?.source;
  function applyResult(next: TransformInput | Record<string, string> | null, mergeSide?: MergeSide) {
    if (!applyAllowed || !tableExecution || !next || tableExecution.sequence !== executionSequence.current) return;
    const { source } = tableExecution;
    setDraft(current => current.values === source
      ? { values: { ...source, ...next }, undo: { identity: transformIdentity, values: source, kind: "apply",
        mergeSide, scopeBound: tableExecution.kind !== "transform" } }
      : current);
  }

  function undoDraft() {
    if (!ownsUndo || editingLocked) return;
    setDraft(current => undo && current.undo === undo ? { values: undo.values } : current);
  }

  async function restoreDraftFile(next: Record<string, string>, expected: Record<string, string>, isCurrent: () => boolean) {
    const owner = draftOwner.current;
    if (!owner || !canReadDraft || readableDraft.current !== expected || !isCurrent()) return false;
    const fresh = await api.loadTool(scope.sceneId, { pluginId: tool.pluginId, capabilityId: tool.capabilityId, revision });
    const available = fresh.enabled && fresh.pluginId === tool.pluginId && fresh.version === tool.version &&
      fresh.capability.id === tool.capabilityId && fresh.revision === revision &&
      !fresh.permissions.some(permission => permission.required && permission.name !== "pi.tools.register");
    if (!available || !isCurrent() || draftOwner.current !== owner || readableDraft.current !== expected) return false;
    setDraft(current => current.values === expected ? { values: next, undo: {
      identity: transformIdentity, values: expected, kind: "import", scopeBound: true,
    } } : current);
    setError(""); setInvalidField(""); setResult(null); setCaptured(null); setTableExecution(null);
    return true;
  }

  async function importFile(file: File, target: ToolFileTarget) {
    const owner = draftOwner.current;
    const allowed = target === singleFileTarget || (tableMerge && (target === leftMergeTarget || target === rightMergeTarget)) ||
      documentFileTargets.some(side => side.target === target);
    if (!owner || owner.identity !== transformIdentity || owner.api !== api ||
        !allowed || !supported || !detail.enabled || editingLocked) return;
    const sequence = ++owner.sequence;
    const isCurrent = () => draftOwner.current === owner && owner.sequence === sequence;
    setFileLoading(target);
    setError("");
    try {
      const formatKey = target === "merge-left" ? "leftFormat" : target === "merge-right" ? "rightFormat" : undefined;
      const choices = fields.find(field => field.key === formatKey)?.choices;
      const next = await readManualToolFile(file, values, target, choices);
      if (!isCurrent()) return;
      setInvalidField("");
      setDraft(current => current.values === values
        ? { values: { ...values, ...next }, undo: { identity: transformIdentity, values, kind: "import" } }
        : current);
    } catch (reason) {
      if (isCurrent()) setError(reason instanceof Error ? reason.message :
        textDiff ? "Could not read the text file." : jsonDocument ? "Could not read the JSON file." : "Could not read the table file.");
    } finally {
      if (isCurrent()) setFileLoading(null);
    }
  }

  async function execute() {
    if (!supported || editingLocked || !detail?.enabled || call.supported === null) return;
    const prepared = prepareToolInput(fields, values);
    const owner = draftOwner.current;
    const sequence = ++executionSequence.current;
    const isLatest = () => alive.current && sequence === executionSequence.current;
    const ownsExecution = () => isLatest() && owner === draftOwner.current;
    setError(""); setStale(false); setInvalidField(""); setResult(null); setCaptured(null); setTableExecution(null);
    if ("error" in prepared) {
      setError(prepared.error); setInvalidField(prepared.field);
      document.getElementById(`${detailId}-${prepared.field}`)?.focus();
      return;
    }
    setRecording(true); setError(""); setResult(null); setCaptured(null);
    try {
      const response = await call.run({ ...scope, pluginId: tool.pluginId, capabilityId: tool.capabilityId,
        input: prepared.input, catalogRevision: detail.revision, ...(supportsResultActions(api) ? { captureResult: true } : {}) });
      if (!isLatest() || ((independentMerge || workbenchApply) && !ownsExecution())) return;
      const outcome = manualToolResult(response.result);
      const wire = response.result;
      const declared = wire !== null && typeof wire === "object" && "contractVersion" in wire &&
        wire.contractVersion === "1.0.0-rc.1";
      if (independentMerge && outcome.successful) {
        const preview = dataMergePreview(outcome.text, declared);
        if (preview) {
          const left = prepareMergeApply("left", fields, values, preview.input);
          const right = prepareMergeApply("right", fields, values, preview.input);
          setTableExecution({ identity: transformIdentity, sequence, api, source: values, kind: "merge", preview, next: { left, right } });
        }
      } else if (workbenchApply && outcome.successful && declared) {
        const draft = prepareWorkbenchApply(tool.capabilityId, values, outcome.text);
        const next = draft && !("error" in prepareToolInput(fields, { text: draft.text, options: draft.options })) ? draft : null;
        setTableExecution({ identity: transformIdentity, sequence, api, source: values, kind: "workbench", next });
      } else if (dataTransform && outcome.successful) {
        const preview = dataTransformPreview(outcome.text);
        if (preview) {
          const input = declared ? prepareTransformApply(tool.capabilityId, values, preview) : null;
          const next = input && !("error" in prepareToolInput(fields, { ...values, ...input })) ? input : null;
          setTableExecution({ identity: transformIdentity, sequence, api, source: values, kind: "transform", preview, next });
        }
      }
      setResult(outcome);
      if (outcome.successful) setCaptured(response);
      if (outcome.successful && accessStore) {
        try {
          await accessStore.mutate(scope, { kind: "recentRecord", id: tool.accessId });
          if (ownsExecution()) onRecentChange?.();
        } catch {
          if (ownsExecution()) setError("Tool completed, but history could not be saved.");
        }
      }
    } catch (reason) {
      if (ownsExecution() && !(reason && typeof reason === "object" && "code" in reason && reason.code === "worker_cancelled")) {
        setError(manualToolError(reason)); setStale(isStaleToolError(reason));
      }
    }
    finally { if (ownsExecution()) setRecording(false); }
  }
  const documentFileButtons = documentFileTargets.map(side => <FileImportButton key={side.target + ":" + transformIdentity}
    label={t(side.label)} inputLabel={t(side.inputLabel)} accept={jsonDocument ? ".json" : sqlFormat ? ".sql" : ""}
    loadingLabel={jsonDocument ? "Reading JSON file…" : sqlFormat ? "Reading SQL file…" : "Reading text file…"}
    disabled={editingLocked || !detail?.enabled} loading={fileLoading === side.target}
    onPick={file => { void importFile(file, side.target); }} />);
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
          const side = documentFileTargets.find(target => target.field === field.key);
          const label = side?.fieldLabel ?? (independentMerge ? independentMergeLabels.get(field.key) : undefined);
          return <ManualToolInput key={field.key} id={`${detailId}-${field.key}`}
            field={label ? { ...field, label: t(label) } : field} value={values[field.key]}
            disabled={editingLocked} invalid={invalidField === field.key}
            compact={independentMerge && (field.key === "leftKey" || field.key === "rightKey")}
            onOmit={() => { setDraft(previous => { const next = { ...previous.values }; delete next[field.key]; return { values: next }; });
              if (invalidField === field.key) { setInvalidField(""); setError(""); } }}
            onChange={value => setDraft(previous => ({ values: { ...previous.values, [field.key]: value } }))} />;
        })}
        {draftFileTool && workbenchDraftActive && <WorkbenchDraftFileActions key={transformIdentity}
          tool={tool} values={values} disabled={!canReadDraft} onRestore={restoreDraftFile} />}
        {jsonSchema && <>
          <div className="ui-toolbar">{documentFileButtons}</div>
          <p className="tool-center-source">{t("Choose Draft 4, 6 or 7 with $schema. Without it, Draft 7 is used. References must stay in the same schema document.")}</p>
        </>}
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
          {!jsonSchema && documentFileButtons}
          {tableMerge && <>
            <FileImportButton key={"left:" + transformIdentity} label={t("Import left table…")}
              inputLabel={t("Left table file")} disabled={editingLocked || !detail.enabled} loading={fileLoading === leftMergeTarget}
              onPick={file => { void importFile(file, leftMergeTarget); }} />
            <FileImportButton key={"right:" + transformIdentity} label={t("Import right table…")}
              inputLabel={t("Right table file")} disabled={editingLocked || !detail.enabled} loading={fileLoading === rightMergeTarget}
              onPick={file => { void importFile(file, rightMergeTarget); }} />
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
    {result !== null && <ManualToolResultView result={result} dataTransform={dataTransform} dataMerge={tableMerge}
      tablePreview={dataTransform ? transformed?.preview ?? null : merged?.preview}
      tableActions={merged ? <MergeResultActions
        enabled={Boolean(applyAllowed)} current={inputsCurrent} applied={applied ? undo?.mergeSide : undefined}
        left={Boolean(merged.next.left)} right={Boolean(merged.next.right)}
        onApply={side => applyResult(merged.next[side], side)} /> : singleDraft && <>
        <div className="ui-toolbar">
        {applied
          ? <span role="status">{singleDraft.kind === "workbench" && singleDraft.next && singleDraft.next.format !== "json"
              ? t("Applied to the input as {format}.").replace("{format}", singleDraft.next.format.toUpperCase())
              : t("Applied to the input as a JSON table.")}</span>
          : alreadyCurrent ? <span role="status">{t("The result already matches the input.")}</span>
            : <>
            <button type="button" className="ui-button ui-button--secondary" disabled={!canApply}
              onClick={() => { if (canApply && singleDraft.next) applyResult({ text: singleDraft.next.text, options: singleDraft.next.options }); }}>{t("Apply to input")}</button>
            {!inputsCurrent
              ? <span className="tool-center-source">{t("The inputs changed. Run the tool again to apply a current result.")}</span>
              : !singleDraft.next && <span className="tool-center-source">{t("This result cannot be applied within the tool’s input contract.")}</span>}
          </>}
        </div>
        {singleDraft.kind === "workbench" && workbenchApply && applyAllowed && singleDraft.next && onOpenWorkbenchDraft &&
          <WorkbenchDraftHandoff sourceId={tool.capabilityId} material={singleDraft.next} onOpen={onOpenWorkbenchDraft} />}
      </>}
      sectionRef={resultRef} onBackToInputs={supported ? () => jumpTo(formRef.current) : undefined} />}
    {captured && supportsResultActions(api) && <ManualToolResultActions response={captured}
      accessStore={accessStore} onRecentChange={onRecentChange}
      scope={{ ...scope, pluginId: tool.pluginId, capabilityId: tool.capabilityId }} gateway={api}
      onBusy={setActionBusy} />}
    <ToolCallDiagnostics trace={call.trace} tool={tool} />
  </section>;
}


function isStaleToolError(reason: unknown): boolean {
  return Boolean(reason && typeof reason === "object" && "code" in reason &&
    (reason.code === "catalog_changed" || reason.code === "capability_changed"));
}
