import { getLocale, t } from "../../i18n.js";

const pluginId = "com.zicode.devtools.disk-inspector";
const capabilityId = "devtools.disk-inspector.scan";
export const directoryUsageProfile = "resource.local-directory.usage.draft1";
export const directoryUsagePermission = "resource.directory.usage.read";

export function isDiskInspector(plugin, capability) {
  return plugin === pluginId && capability === capabilityId;
}

const byteCount = value => typeof value === "string" && /^(0|[1-9][0-9]{0,38})$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const number = value => value.toLocaleString(getLocale());
const size = value => t("{bytes} B").replace("{bytes}", BigInt(value).toLocaleString(getLocale()));
function safePath(value, shortened) {
  if (typeof value !== "string" || /[\\:\p{Cc}]/u.test(value) || value.startsWith("/")) return false;
  const bytes = new TextEncoder().encode(value).length;
  if (bytes > 512 || (shortened && bytes < 509)) return false;
  const segments = value.split("/");
  return segments.every((part, index) => (part !== "" && part !== "." && part !== "..") ||
    (shortened && index > 0 && index === segments.length - 1));
}
const rows = values => Array.isArray(values) && values.length <= 20 && values.every(entry =>
  safePath(entry?.path, entry?.pathTruncated) && byteCount(entry.logicalBytes) && typeof entry.pathTruncated === "boolean");

function node(tag, content) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  return element;
}

function showRanking(heading, entries) {
  const section = node("section");
  section.append(node("h4", t(heading)));
  if (!entries.length) {
    section.append(node("p", t("No entries in this result.")));
    return section;
  }
  const list = node("ol");
  for (const entry of entries) {
    const item = node("li");
    item.append(node("strong", size(entry.logicalBytes)), " · ", node("bdi", entry.path));
    if (entry.pathTruncated) item.append(" · ", t("Path shortened"));
    list.append(item);
  }
  section.append(list);
  return section;
}

const sourceLimits = {
  entries: "Entry limit reached.",
  time: "Scan time limit reached.",
  snapshot_bytes: "Directory snapshot size limit reached.",
};
function showPartial(report) {
  if (!report.partial) return null;
  const section = node("section");
  section.append(node("p", t("This scan is partial. Totals and rankings cover only the entries examined.")));
  const source = report.source;
  const limit = Object.hasOwn(sourceLimits, source?.limitReason) ? sourceLimits[source.limitReason] : null;
  if (limit) section.append(node("p", t(limit)));
  for (const [key, label] of [
    ["skippedLinks", "Skipped links: {count}"],
    ["skippedDepth", "Beyond the scan depth: {count}"],
    ["skippedNames", "Unsupported names: {count}"],
    ["unreadable", "Unreadable entries: {count}"],
  ]) {
    const omitted = source?.[key];
    if (count(omitted) && omitted > 0) section.append(node("p", t(label).replace("{count}", number(omitted))));
  }
  if (source === null || report.analysis?.limitReason === "analysis_bytes") {
    section.append(node("p", t("Analysis input limit reached.")));
  }
  return section;
}

export function renderDiskInspectorResult(container, report) {
  container.replaceChildren();
  if (report?.ok !== true || report.schemaVersion !== 1 || report.material !== "directory-usage-report" ||
    typeof report.partial !== "boolean" ||
    (report.source === null && (!report.partial || report.analysis?.limitReason !== "analysis_bytes")) ||
    (report.source?.partial === true && !report.partial) ||
    !byteCount(report.logicalBytes) || !byteCount(report.rootFilesLogicalBytes) ||
    ![report.fileCount, report.directoryCount, report.groupCount].every(count) ||
    !rows(report.groups) || !rows(report.largestFiles)) return false;

  const summary = node("dl");
  for (const [label, value] of [
    ["Total logical size", size(report.logicalBytes)],
    ["Files directly in the chosen folder", size(report.rootFilesLogicalBytes)],
    ["File count", number(report.fileCount)],
    ["Folder count", number(report.directoryCount)],
  ]) summary.append(node("dt", t(label)), node("dd", value));
  const card = node("div");
  card.className = "tool-result";
  const partial = showPartial(report);
  if (partial) card.append(partial);
  card.append(summary, showRanking("Largest immediate folders", report.groups),
    showRanking("Largest files", report.largestFiles));
  container.append(card);
  return true;
}
