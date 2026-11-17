import { t } from "../../i18n.js";
import { fileDigestComparison } from "./file-digest-comparison.js";

export const STREAM_PROFILE = "resource.local-file.digest-stream.draft1";
export const REPORT_PROFILE = "resource.host.file-digest-stream-report.draft1";
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const ownerKeys = ["runtimeId", "sessionId", "pluginId", "capabilityId"];
const sameOwner = (left, right) => ownerKeys.every(key => left?.[key] === right?.[key]);
const size = value => Number.isSafeInteger(value) && value >= 0;

export function streamSelection(value, owner) {
  if (value?.schemaVersion !== 1 || value.profile !== STREAM_PROFILE || !UUID.test(value.grantId ?? "") ||
      value.contentRead !== false || value.confirmed !== false || !sameOwner(owner, value.owner) ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 64 ||
      !value.files.every(file => typeof file?.name === "string" && [...file.name].length >= 1 && [...file.name].length <= 255 &&
        !/[\\/:\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(file.name) && size(file.byteLength)) ||
      !size(value.totalBytes) || value.totalBytes !== value.files.reduce((sum, file) => sum + file.byteLength, 0)) {
    throw new Error("resource_stream_invalid");
  }
  return { grantId: value.grantId, owner, totalBytes: value.totalBytes,
    files: value.files.map(({ name, byteLength }) => ({ name, byteLength })) };
}

export function streamReportAccess(value, owner) {
  const access = value?.reportAccess;
  if (access?.schemaVersion !== 1 || !sameOwner(access.owner, owner) ||
      !UUID.test(access.resourceId ?? "") || !HASH.test(access.contentVersion ?? "")) return null;
  return { schemaVersion: 1, owner, resourceId: access.resourceId, contentVersion: access.contentVersion };
}

export function streamReport(value, selection, input) {
  const access = streamReportAccess(value, selection.owner), resource = value?.reportResource, rows = value?.result?.files;
  const names = selection.files.map(file => file.name);
  if (value?.schemaVersion !== 1 || value.profile !== STREAM_PROFILE || !access ||
      resource?.profile !== REPORT_PROFILE || resource.origin !== "host-report" || resource.mimeType !== "application/json" ||
      resource.saved !== false || resource.index !== 0 || resource.resourceId !== access.resourceId || resource.contentVersion !== access.contentVersion ||
      !size(resource.byteLength) || resource.byteLength < 1 || resource.byteLength > 128 * 1024 ||
      value.result?.ok !== true || value.result.schemaVersion !== 2 || value.result.material !== "file-integrity-report-list" ||
      !Array.isArray(rows) || rows.length !== names.length || !rows.every((row, index) => row?.index === index &&
        row.bytes === selection.files[index].byteLength && HASH.test(row.sha256 ?? "") && /^[0-9a-f]{128}$/.test(row.sha512 ?? ""))) {
    throw new Error("resource_stream_invalid");
  }
  fileDigestComparison(input, rows);
  return { access, resource, names, rows, result: value.result };
}

export function streamOriginal(value, report, index) {
  const access = streamReportAccess({ reportAccess: value?.access }, report.access.owner), row = report.rows[index];
  if (!row || !access || value.schemaVersion !== 1 || value.contentRead !== false || value.mimeType !== "application/octet-stream" ||
      value.fileName !== report.names[index] || row.bytes !== value.byteLength || row.sha256 !== access.contentVersion) throw new Error("resource_stream_invalid");
  return { resourceId: access.resourceId, contentVersion: access.contentVersion,
    mimeType: value.mimeType, fileName: value.fileName, byteLength: value.byteLength, originalFile: true };
}

export function streamProgress(container, query, selection, isCurrent) {
  const root = document.createElement("div"), meter = document.createElement("progress"), label = document.createElement("span");
  meter.setAttribute("aria-label", t("Checksum file reading progress"));
  label.setAttribute("role", "status");
  root.append(meter, label); container.append(root);
  const count = selection.files.length, total = selection.totalBytes;
  let stopped = false, timer;
  async function poll() {
    if (stopped || !isCurrent()) return;
    try {
      const response = await query();
      if (!stopped && isCurrent() && response?.schemaVersion === 1 && response.profile === STREAM_PROFILE &&
          response.grantId === selection.grantId && response.fileCount === count && response.totalBytes === total &&
          size(response.completedFiles) && response.completedFiles <= count && size(response.bytesRead) && response.bytesRead <= total) {
        meter.max = total || count;
        meter.value = total ? response.bytesRead : response.completedFiles;
        label.textContent = t("{completed} of {total} files processed").replace("{completed}", String(response.completedFiles)).replace("{total}", String(count));
      }
    } catch { /* Advisory status while the Host starts or finishes. */ }
    if (!stopped && isCurrent()) timer = setTimeout(poll, 200);
  }
  void poll();
  return () => { stopped = true; clearTimeout(timer); root.remove(); };
}
