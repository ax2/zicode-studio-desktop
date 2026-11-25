import { springConfigFileTargets, supportsSpringConfigFiles } from "./spring-config-files";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { FileImportButton } from "./FileImportButton";
import { WorkbenchDraftFileActions } from "./WorkbenchDraftFileActions";
import type { ToolAccessScope, ToolAccessStore } from "../commandPalette/tool-access";
import { type ManualTool, type ManualToolApi, type ToolDetail, manualToolError, supportsResultActions, toolDraftContract } from "./manual-tools";
import { toolFields, prepareToolInput } from "./manual-tool-fields";
import { ManualToolInput } from "./ManualToolInput";
import { ManualToolInformation } from "./ManualToolInformation";
import type { CapturedToolResponse } from "../../../../public/native/plugins/plugin-result-actions.js";
import { ManualToolResultActions } from "./ManualToolResultActions";
import { ManualToolResultView } from "./ManualToolResultView";
import { downloadFile } from "../../shared/download-file";
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

const jsonObjectFileTargets = [
  { target: "json-object", field: "value", label: "Import JSON file…", inputLabel: "JSON input file", fieldLabel: "JSON text" },
] as const;

const jsonSchemaFileTargets = [
  { target: "schema-instance", field: "instance", label: "Import JSON instance…", inputLabel: "JSON instance file", fieldLabel: "JSON instance" },
  { target: "schema-root", field: "schema", label: "Import JSON Schema…", inputLabel: "JSON Schema file", fieldLabel: "Root JSON Schema" },
] as const;

const sqlFileTargets = [
  { target: "sql-format", field: "text", label: "Import SQL file…", inputLabel: "SQL file", fieldLabel: "SQL text" },
] as const;

// Frozen Text capabilities reviewed for this file and output workflow.
const textFileProfiles = new Map<string, "text-only" | "sql-options">([
  ["0.4.1", "text-only"], ["0.4.2", "sql-options"], ["0.4.3", "sql-options"], ["0.4.4", "sql-options"],
]);

const sqlOptions = new Map<string, { label: string; defaultValue: string; choices: ReadonlyMap<string, string> }>([
  ["dialect", { label: "SQL dialect", defaultValue: "generic", choices: new Map([
    ["generic", "Generic SQL"], ["postgresql", "PostgreSQL"], ["mysql", "MySQL"],
    ["sqlite", "SQLite"], ["sqlserver", "SQL Server"],
  ]) }],
  ["indent", { label: "Indentation", defaultValue: "fourSpaces", choices: new Map([
    ["twoSpaces", "2 spaces"], ["fourSpaces", "4 spaces"], ["tabs", "Tabs"],
  ]) }],
  ["keywordCase", { label: "Keyword case", defaultValue: "uppercase", choices: new Map([
    ["uppercase", "Uppercase"], ["lowercase", "Lowercase"], ["preserve", "Keep original case"],
  ]) }],
]);

const yamlToJsonFiles = [
  { target: "yaml-to-json", field: "text", label: "Import YAML file…", inputLabel: "YAML input file", fieldLabel: "YAML text" },
] as const;
const yamlFromJsonFiles = [
  { target: "yaml-from-json", field: "text", label: "Import JSON file…", inputLabel: "JSON input file", fieldLabel: "JSON text" },
] as const;

const byteTextFileTargets = [
  { target: "utf8-bytes", field: "text", label: "Import UTF-8 text file…", inputLabel: "UTF-8 text file", fieldLabel: "Source text" },
] as const;
const utf8FileTargets = [
  { target: "utf8-text", field: "text", label: "Import UTF-8 text file…", inputLabel: "UTF-8 text file", fieldLabel: "Source text" },
] as const;
const qrFileTargets = [
  { target: "qr-source", field: "text", label: "Import UTF-8 text file…", inputLabel: "UTF-8 text file", fieldLabel: "Source text" },
] as const;
const traceFileTargets = [
  { target: "utf8-text", field: "text", label: "Import log file…", inputLabel: "Log file", fieldLabel: "Source text" },
] as const;
const urlTextFileTargets = [
  { target: "url-inspect", field: "text", label: "Import URL text file…", inputLabel: "URL text file", fieldLabel: "URL text" },
] as const;
const hexFiles = [
  { target: "utf8-text", field: "text", label: "Import Hex text file…", inputLabel: "Hex text file", fieldLabel: "Hex text" },
] as const;
const jsonStringFiles = [
  { target: "utf8-text", field: "text", label: "Import JSON string file…", inputLabel: "JSON string file", fieldLabel: "JSON string" },
] as const;
const base64DecodeFiles = [
  { target: "base64-decode", field: "text", label: "Import Base64 file…", inputLabel: "Base64 input file", fieldLabel: "Base64 text" },
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
  onReload?(draft?: { contract: string; read(): Record<string, string> | undefined }): Promise<void>;
  initialDraft?: Record<string, string>;
  focusInitialDraft?: boolean;
  workbenchDraftActive?: boolean;
  draftReaderRef?(reader: WorkbenchDraftReader | null): void;
  onOpenWorkbenchDraft?: OpenWorkbenchDraft;
}

interface ToolDraft {
  values: Record<string, string>;
  undo?: {
    identity: string; values: Record<string, string>; kind: "apply" | "import";
    mergeSide?: MergeSide; scopeBound?: boolean; textDiffField?: string;
  };
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

export function ManualToolDetailView({ tool, revision, api, scope, accessStore, onOpenApplication, onBusy, onRecentChange, getResourceTarget, receiveNoteDraft, resourceSession, onReload, initialDraft, focusInitialDraft = true, draftReaderRef, onOpenWorkbenchDraft, workbenchDraftActive = true, call }: ManualToolDetailProps & {
  call: ReturnType<typeof useManualToolCall>;
}) {
  const detailOwner = useMemo(() => ({ api, sceneId: scope.sceneId, pluginId: tool.pluginId, capabilityId: tool.capabilityId, revision }),
    [api, scope.sceneId, tool.pluginId, tool.capabilityId, revision]);
  const [loadedDetail, setLoadedDetail] = useState<{ owner: typeof detailOwner; value: ToolDetail } | null>(null);
  const detail = loadedDetail?.owner === detailOwner ? loadedDetail.value : null;
  const detailId = useId();
  const [{ values, undo }, setDraft] = useState<ToolDraft>(() => ({ values: initialDraft ?? {} }));
  const latestValues = useRef(values);
  useLayoutEffect(() => { latestValues.current = values; }, [values]);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [invalidField, setInvalidField] = useState("");
  const [recording, setRecording] = useState(false);
  const running = call.busy || recording;
  const [result, setResult] = useState<ManualToolResult | null>(null);
  const [downloadExecution, setDownloadExecution] = useState<(DraftExecution & { text: string }) | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);
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
  useEffect(() => { if (focusInitialDraft && initialDraft && supported) formRef.current?.focus({ preventScroll: true }); }, [focusInitialDraft, initialDraft, supported]);
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
  const enabledWasi = tool.runtime === "wasi" && detail?.enabled && detail.version === tool.version;
  const jsonObject = enabledWasi && tool.version === "0.1.1" && tool.pluginId === "com.zicode.devtools.json-object" &&
    tool.capabilityId === "devtools.json.object.inspect" && detail.pluginId === tool.pluginId &&
    detail.capability.id === tool.capabilityId && fields?.length === 1 &&
    fields[0].key === "value" && fields[0].kind === "object" && fields[0].required;
  const textField = fields?.find(field => field.key === "text" && field.kind === "string");
  const boundedTextTool = enabledWasi && textField?.maxLength === 8192;
  const regexMatches = boundedTextTool && comparePlugin && tool.version === "0.1.0" &&
    tool.capabilityId === "devtools.compare.regex.matches";
  const computeQrFile = boundedTextTool && computePlugin && (tool.version === "0.1.0" || tool.version === "0.2.0") &&
    tool.capabilityId === "devtools.compute.qr.png";
  const independentQrFile = enabledWasi && tool.pluginId === "com.zicode.devtools.qr" && tool.version === "0.1.0" &&
    tool.capabilityId === "devtools.qr.png" && fields?.length === 1 && textField?.maxLength === 2048;
  const qrFileTool = computeQrFile || independentQrFile;
  const inspectTool = boundedTextTool && tool.pluginId === "com.zicode.devtools.inspect" && tool.version === "0.1.2";
  const yamlToJson = inspectTool && tool.capabilityId === "devtools.inspect.yaml.to_json";
  const yamlFromJson = inspectTool && tool.capabilityId === "devtools.inspect.yaml.from_json";
  const unicodeInspect = inspectTool && tool.capabilityId === "devtools.inspect.unicode.inspect";
  const unicodeNfc = inspectTool && tool.capabilityId === "devtools.inspect.unicode.nfc";
  const unicodeNfkc = inspectTool && tool.capabilityId === "devtools.inspect.unicode.nfkc";
  const unicodeNormalize = unicodeNfc || unicodeNfkc;
  const springConfig = boundedTextTool && fields !== null && detail?.version === tool.version && supportsSpringConfigFiles(tool, fields);
  const tracePlugin = boundedTextTool && tool.pluginId === "com.zicode.devtools.trace" && tool.version === "0.1.1";
  const javaTrace = tracePlugin && tool.capabilityId === "devtools.trace.java.trace";
  const pythonTrace = tracePlugin && tool.capabilityId === "devtools.trace.django.trace";
  const traceReport = javaTrace || pythonTrace;
  const textProfile = textFileProfiles.get(tool.version);
  const textSchema = detail?.capability.inputSchema as { additionalProperties?: unknown; minProperties?: unknown; maxProperties?: unknown } | undefined;
  const textPlugin = boundedTextTool && tool.enabled && tool.pluginId === "com.zicode.devtools.text" &&
    detail?.pluginId === tool.pluginId && detail.capability.id === tool.capabilityId && Boolean(textProfile) &&
    textField.required && textField.minLength === 0 && !textField.choices && textSchema?.additionalProperties === false &&
    textSchema.minProperties === undefined && textSchema.maxProperties === undefined;
  const textOnlyContract = textPlugin && fields?.length === 1;
  const transformsTool = boundedTextTool && tool.pluginId === "com.zicode.devtools.transforms" && tool.version === "0.1.1";
  const textLines = transformsTool && /^devtools\.transforms\.lines\.(deduplicate|ascending|descending|nonempty|trim)$/.test(tool.capabilityId);
  const textStatistics = transformsTool && tool.capabilityId === "devtools.transforms.stats.inspect";
  const urlInspect = transformsTool && tool.capabilityId === "devtools.transforms.url.inspect";
  const urlDecode = transformsTool && tool.capabilityId === "devtools.transforms.url.decode";
  const htmlEscape = transformsTool && tool.capabilityId === "devtools.transforms.html.escape";
  const htmlUnescape = transformsTool && tool.capabilityId === "devtools.transforms.html.unescape";
  const htmlText = htmlEscape || htmlUnescape;
  const stringEscape = transformsTool && tool.capabilityId === "devtools.transforms.string.escape";
  const stringUnescape = transformsTool && tool.capabilityId === "devtools.transforms.string.unescape";
  const hexEncode = transformsTool && tool.capabilityId === "devtools.transforms.hex.encode";
  const hexDecode = transformsTool && tool.capabilityId === "devtools.transforms.hex.decode";
  const sqlWithOptions = textPlugin && tool.capabilityId === "devtools.text.sql.format" &&
    textProfile === "sql-options" && fields?.length === sqlOptions.size + 1 && fields.every(field => {
      if (field.key === "text") return true;
      const option = sqlOptions.get(field.key);
      return option && field.kind === "string" && !field.required &&
        field.minLength === 0 && field.maxLength === 32768 && field.suggested?.preview === option.defaultValue &&
        field.choices?.length === option.choices.size &&
        field.choices.every(choice => typeof choice === "string" && option.choices.has(choice));
    });
  const sqlFormat = tool.capabilityId === "devtools.text.sql.format" &&
    (sqlWithOptions || (textOnlyContract && textProfile === "text-only"));
  let failureNotice: string | undefined;
  if (sqlFormat && result?.errorCode === "INPUT_TOO_LARGE" && result.errorMessage === "结果超过 48 KiB") {
    // The frozen Text contract also uses INPUT_TOO_LARGE for requests and input text.
    const indentChoices = fields?.find(field => field.key === "indent")?.choices;
    const indent = values.indent ? indentChoices?.[Number(values.indent)] : "fourSpaces";
    const canReduceIndent = sqlWithOptions && indent === "fourSpaces";
    failureNotice = canReduceIndent
      ? t("Formatted SQL exceeds the 48 KiB output limit. Select 2 spaces for indentation and run again.")
      : t("Formatted SQL exceeds the 48 KiB output limit.");
  }
  const base64Encode = textOnlyContract && tool.capabilityId === "devtools.text.base64.encode";
  const base64Decode = textOnlyContract && tool.capabilityId === "devtools.text.base64.decode";
  const base64Tool = base64Encode || base64Decode;
  const textSha256 = textOnlyContract && tool.capabilityId === "devtools.text.sha256";
  const documentFileTargets = textDiff ? textDiffFileTargets : jsonDiff ? jsonDiffFileTargets : jsonObject ? jsonObjectFileTargets :
    jsonSchema ? jsonSchemaFileTargets : qrFileTool ? qrFileTargets : sqlFormat ? sqlFileTargets :
      yamlToJson ? yamlToJsonFiles : yamlFromJson ? yamlFromJsonFiles :
        (base64Encode || hexEncode || textSha256 || unicodeInspect || unicodeNormalize) ? byteTextFileTargets : base64Decode ? base64DecodeFiles :
          stringUnescape ? jsonStringFiles : hexDecode ? hexFiles : urlInspect ? urlTextFileTargets : traceReport ? traceFileTargets : springConfig ? springConfigFileTargets :
          (textLines || textStatistics || stringEscape || htmlText || urlDecode || regexMatches) ? utf8FileTargets : [];
  const jsonDocument = jsonPath || jsonDiff || jsonObject || jsonSchema || yamlFromJson;
  const textDownload = sqlFormat ? { label: "Download formatted SQL", stem: "formatted-sql", extension: "sql", mime: "application/sql" }
    : yamlToJson ? { label: "Download JSON", stem: "converted", extension: "json", mime: "application/json" }
    : yamlFromJson ? { label: "Download YAML", stem: "converted", extension: "yaml", mime: "application/yaml" }
    : base64Encode ? { label: "Download Base64 file", stem: "encoded", extension: "base64", mime: "text/plain" }
    : base64Decode ? { label: "Download decoded text", stem: "decoded", extension: "txt", mime: "text/plain;charset=utf-8" }
    : textSha256 ? { label: "Download SHA-256 digest", stem: "sha256", extension: "txt", mime: "text/plain" }
    : textLines ? { label: "Download processed text", stem: "processed", extension: "txt", mime: "text/plain;charset=utf-8" }
    : textStatistics ? { label: "Download text statistics", stem: "text-statistics", extension: "txt", mime: "text/plain;charset=utf-8" }
    : stringEscape ? { label: "Download JSON", stem: "escaped-string", extension: "json", mime: "application/json" }
    : stringUnescape ? { label: "Download restored text", stem: "restored-string", extension: "txt", mime: "text/plain;charset=utf-8" }
    : hexEncode ? { label: "Download Hex text", stem: "hex-bytes", extension: "txt", mime: "text/plain" }
    : hexDecode ? { label: "Download decoded text", stem: "hex-decoded", extension: "txt", mime: "text/plain;charset=utf-8" }
    : urlInspect ? { label: "Download JSON", stem: "url-details", extension: "json", mime: "application/json" }
    : urlDecode ? { label: "Download decoded text", stem: "url-decoded", extension: "txt", mime: "text/plain;charset=utf-8" }
    : htmlEscape ? { label: "Download escaped text", stem: "html-escaped", extension: "txt", mime: "text/plain;charset=utf-8" }
    : htmlUnescape ? { label: "Download restored text", stem: "html-restored", extension: "txt", mime: "text/plain;charset=utf-8" }
    : springConfig ? { label: "Download JSON", stem: "spring-config-comparison", extension: "json", mime: "application/json" }
    : traceReport ? { label: "Download JSON", stem: javaTrace ? "java-trace" : "python-trace", extension: "json", mime: "application/json" }
    : unicodeInspect ? { label: "Download JSON", stem: "unicode-code-points", extension: "json", mime: "application/json" }
    : unicodeNormalize ? { label: "Download normalized text", stem: unicodeNfc ? "unicode-nfc" : "unicode-nfkc", extension: "txt", mime: "text/plain;charset=utf-8" } : null;
  const singleTableTarget = dataTransform ? "transform" : tableWorkbench ? "workbench" : qualityFormat;
  const singleFileTarget = jsonPath ? "json-path" : singleTableTarget;
  const transformIdentity = JSON.stringify([scope.sceneId, scope.workspaceId, tool.pluginId, tool.capabilityId, revision]);
  useLayoutEffect(() => {
    draftOwner.current = { identity: transformIdentity, api, sequence: 0 };
    setFileLoading(null);
    setRecording(false);
    setTableExecution(current => current?.kind === "transform" ? current : null);
    setDownloadExecution(null); setDownloadFailed(false);
    setDraft(current => current.undo?.scopeBound ? { values: current.values } : current);
    return () => { draftOwner.current = null; };
  }, [transformIdentity, api]);
  const downloadableResult = textDownload && detail?.revision === revision && detail.pluginId === tool.pluginId &&
    detail.capability.id === tool.capabilityId && tool.enabled && downloadExecution?.identity === transformIdentity &&
    downloadExecution.api === api && downloadExecution.sequence === executionSequence.current && downloadExecution.source === values
    ? downloadExecution : null;
  function downloadTextResult() {
    if (editingLocked || !textDownload || !downloadableResult || downloadableResult.sequence !== executionSequence.current) return;
    setDownloadFailed(false);
    try {
      const { stem, extension, mime } = textDownload;
      downloadFile(`${stem}-${Date.now()}.${extension}`, downloadableResult.text, mime);
    } catch {
      setDownloadFailed(true);
    }
  }

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
      const textDiffField = textDiff ? textDiffFileTargets.find(side => side.target === target)?.field : undefined;
      setDraft(current => current.values === values
        ? {
          values: { ...values, ...next },
          undo: { identity: transformIdentity, values, kind: "import", textDiffField },
        }
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
    setDownloadExecution(null); setDownloadFailed(false);
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
      const outcome = manualToolResult(response.result, jsonObject ? { reference: response.resultRef } : undefined);
      const wire = response.result;
      const declared = wire !== null && typeof wire === "object" && "contractVersion" in wire &&
        wire.contractVersion === "1.0.0-rc.1";
      const validTextOutput = textSha256 ? /^[0-9a-f]{64}$/.test(outcome.text) :
        (base64Tool || textLines || stringUnescape || hexEncode || hexDecode || htmlText || unicodeNormalize || urlDecode || outcome.text.trim().length > 0);
      if (textDownload && ownsExecution() && outcome.successful && declared && validTextOutput) {
        setDownloadExecution({ identity: transformIdentity, sequence, api, source: values, text: outcome.text });
      }
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
    label={t(side.label)} inputLabel={t(side.inputLabel)}
    accept={jsonDocument ? ".json" : sqlFormat ? ".sql" : yamlToJson ? ".yaml,.yml" :
      base64Decode ? ".base64,.b64,.txt" : stringUnescape ? ".json,.txt" : hexDecode ? ".txt,.hex" : urlInspect || qrFileTool ? ".txt" :
        htmlText ? ".html,.htm,.txt" : traceReport ? ".log,.txt,.traceback" : springConfig ? ".json,.yaml,.yml" : ""}
    loadingLabel={jsonDocument ? "Reading JSON file…" : sqlFormat ? "Reading SQL file…" :
      yamlToJson ? "Reading YAML file…" : springConfig ? "Reading configuration file…" : "Reading text file…"}
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
        const contract = detail && supported ? toolDraftContract(tool, detail, revision) : null;
        const seed = contract ? { contract, read: () => alive.current ? latestValues.current : undefined } : undefined;
        void onReload(seed).catch(reason => { if (alive.current) setError(manualToolError(reason)); })
          .finally(() => { if (alive.current) setReloading(false); });
      }}>{t(reloading ? "Reloading tool details…" : "Reload tool details")}</button>}
    {call.phase === "cancelled" && <p role="status">{t("Tool cancelled. No result was kept.")}</p>}
    {call.notice && <p role="status" key={call.notice}>{t(call.notice)}</p>}
    {detail && <>
      {!detail.enabled && <p role="status">{t("Plugin is disabled")}</p>}
      {!detail.enabled && <p>{t("Enable this plugin in Plugin Manager before running its tools.")}</p>}
      {resourceTool ? <ResourceToolRunner tool={tool} detail={detail} api={api} getTarget={getResourceTarget} scope={scope}
        accessStore={accessStore} onBusy={setResourceBusy} onRecentChange={onRecentChange} session={resourceSession} receiveNoteDraft={receiveNoteDraft} /> : supported ? <form ref={formRef} tabIndex={-1} aria-label={t("Tool inputs")} onSubmit={event => { event.preventDefault(); void execute(); }}>
        {springConfig && <div className="ui-toolbar">{documentFileButtons}</div>}
        {fields.map(field => {
          const side = documentFileTargets.find(target => target.field === field.key);
          const sqlOption = sqlWithOptions ? sqlOptions.get(field.key) : undefined;
          const label = side?.fieldLabel ?? sqlOption?.label ?? (independentMerge ? independentMergeLabels.get(field.key) : undefined);
          return <ManualToolInput key={field.key} id={`${detailId}-${field.key}`}
            field={label ? { ...field, label: t(label) } : field} value={values[field.key]} choiceLabels={sqlOption?.choices}
            disabled={editingLocked} invalid={invalidField === field.key}
            compact={independentMerge && (field.key === "leftKey" || field.key === "rightKey")}
            onOmit={() => { setDraft(previous => { const next = { ...previous.values }; delete next[field.key]; return { values: next }; });
              if (invalidField === field.key) { setInvalidField(""); setError(""); } }}
            onChange={value => setDraft(previous => {
              const next = { ...previous.values, [field.key]: value };
              const previousUndo = previous.undo;
              const editsOtherDiffSide = textDiff && previousUndo?.textDiffField &&
                (field.key === "left" || field.key === "right") && field.key !== previousUndo.textDiffField;
              if (previousUndo?.kind === "import" && previousUndo.identity === transformIdentity &&
                  (editsOtherDiffSide || (jsonPath && field.key === "query") || (regexMatches && field.key === "pattern"))) {
                return { values: next, undo: { ...previousUndo, values: { ...previousUndo.values, [field.key]: value } } };
              }
              return { values: next };
            })} />;
        })}
        {textSha256 && <p className="tool-center-source">{t("The digest uses the current text. Import preserves the UTF-8 BOM, line endings, and trailing spaces.")}</p>}
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
          {!jsonSchema && !springConfig && documentFileButtons}
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
      failureNotice={failureNotice}
      tablePreview={dataTransform ? transformed?.preview ?? null : merged?.preview}
      actions={downloadableResult && textDownload ? <>
        <div className="ui-toolbar">
          <button type="button" className="ui-button ui-button--secondary" disabled={editingLocked}
            onClick={downloadTextResult}>{t(textDownload.label)}</button>
        </div>
        {downloadFailed && <p role="alert">{t("Could not download the converted file.")}</p>}
      </> : merged ? <MergeResultActions
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
