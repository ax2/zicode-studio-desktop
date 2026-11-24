import { getLocale, t } from "../../i18n.js";

const pluginId = "com.zicode.devtools.directory-compare";
const capabilityId = "devtools.directory-compare.scan";
export const directoryCompareProfile = "resource.local-directory.compare.draft1";
export const directoryComparePermission = "resource.directory.compare.read";

export function isDirectoryCompare(plugin, capability) {
  return plugin === pluginId && capability === capabilityId;
}

const differenceLabels = {
  onlyLeft: "Only on the left",
  onlyRight: "Only on the right",
  typeMismatch: "Different entry types",
  sizeMismatch: "Different file sizes",
  contentMismatch: "Different file contents",
  unverified: "Contents not verified",
  changed: "File changed during comparison",
  readError: "File could not be read",
};
const confirmedKinds = ["onlyLeft", "onlyRight", "typeMismatch", "sizeMismatch", "contentMismatch"];
const limitLabels = {
  entries: "Entry limit reached.",
  time: "Scan time limit reached.",
  snapshot_bytes: "Directory snapshot size limit reached.",
  links: "Links skipped during comparison.",
  depth: "Depth limit reached.",
  names: "Unsupported path names skipped.",
  read_error: differenceLabels.readError,
  pairs: "Path pair limit reached.",
  hash_bytes: "Candidate file read budget reached.",
  changed: differenceLabels.changed,
};
const count = value => Number.isSafeInteger(value) && value >= 0;
const number = value => value.toLocaleString(getLocale());
const isDecimalSize = value => typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value) &&
  BigInt(value) <= 18446744073709551615n;

function relativePath(value) {
  return typeof value === "string" && !/[\\:\p{Cc}]/u.test(value) &&
    value.split("/").every(part => part && part !== "." && part !== "..") &&
    new TextEncoder().encode(value).length <= 2048;
}

function entry(side) {
  if (side == null) return true;
  if (side.kind === "directory") return side.logicalBytes == null && side.sha256 == null;
  return side.kind === "file" && (side.logicalBytes == null || isDecimalSize(side.logicalBytes)) &&
    (side.sha256 == null || (typeof side.sha256 === "string" && /^[0-9a-f]{64}$/.test(side.sha256)));
}

function reportGroups(report) {
  if (report?.ok !== true || report.schemaVersion !== 1 || report.material !== "directory-compare-report" ||
      typeof report.coverageComplete !== "boolean" || typeof report.partial !== "boolean" ||
      typeof report.projectionTruncated !== "boolean" ||
      ![report.totalPaths, report.sameFiles, report.sameDirectories, report.unassessedOneSide, report.differenceCount].every(count) ||
      !Array.isArray(report.limitReasons) || report.limitReasons.length > 16 ||
      !report.limitReasons.every(reason => typeof reason === "string" && /^[a-z][a-z0-9_]{0,31}$/.test(reason)) ||
      !Array.isArray(report.rows) || report.rows.length > Math.min(256, report.differenceCount)) return null;

  const counts = report.differenceCounts;
  const kinds = Object.keys(differenceLabels);
  if (!counts || !kinds.every(kind => count(counts[kind])) ||
      kinds.reduce((sum, kind) => sum + counts[kind], 0) !== report.differenceCount ||
      report.sameFiles + report.sameDirectories + report.differenceCount + report.unassessedOneSide > report.totalPaths ||
      (!report.coverageComplete && (!report.partial || counts.onlyLeft || counts.onlyRight)) ||
      (report.coverageComplete && report.unassessedOneSide > 0)) return null;

  const grouped = new Map();
  const paths = new Set();
  for (const row of report.rows) {
    const kind = row?.difference;
    if (!Object.hasOwn(differenceLabels, kind) || !relativePath(row.path) || paths.has(row.path) ||
        !entry(row.left) || !entry(row.right) || (row.left == null && row.right == null) ||
        (kind === "onlyLeft" && (row.left == null || row.right != null)) ||
        (kind === "onlyRight" && (row.right == null || row.left != null))) return null;
    if (!grouped.has(kind)) grouped.set(kind, []);
    const rows = grouped.get(kind);
    if (rows.length >= counts[kind]) return null;
    paths.add(row.path);
    rows.push(row);
  }
  return grouped;
}

function node(tag, content) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  return element;
}

function entryText(side, coverageComplete) {
  if (side == null) return t(coverageComplete ? "No entry" : "Not assessed");
  if (side.kind === "directory") return t("Folder");
  const bytes = side.logicalBytes;
  return bytes == null ? t("File") :
    `${t("File")} · ${t("{bytes} B").replace("{bytes}", number(BigInt(bytes)))}`;
}

function showGroup(kind, total, rows, coverageComplete) {
  const details = node("details");
  details.append(node("summary", `${t(differenceLabels[kind])} · ${number(total)}`));
  const list = node("ul");
  for (const row of rows) {
    const item = node("li");
    const sides = node("div");
    sides.className = "ui-muted";
    sides.append(node("span", `${t("Left")} · ${entryText(row.left, coverageComplete)}`), " / ",
      node("span", `${t("Right")} · ${entryText(row.right, coverageComplete)}`));
    item.append(node("bdi", row.path), sides);
    list.append(item);
  }
  details.append(list);
  return details;
}

export function renderDirectoryCompareResult(container, report) {
  container.replaceChildren();
  const grouped = reportGroups(report);
  if (!grouped) return false;

  const card = node("div");
  card.className = "tool-result";
  card.append(node("p", t(report.coverageComplete ? "Both folder listings are complete." :
    "Folder coverage is incomplete. Items seen on one side may still exist on the other.")));
  if (report.partial && report.coverageComplete) {
    card.append(node("p", t("Some comparisons could not be confirmed.")));
  }
  if (report.limitReasons.length) {
    const reasons = node("ul");
    const labels = new Set(report.limitReasons.map(reason =>
      Object.hasOwn(limitLabels, reason) ? limitLabels[reason] : "Another scan limit was reached."));
    for (const label of labels) reasons.append(node("li", t(label)));
    card.append(reasons);
  }

  const confirmed = confirmedKinds.reduce((sum, kind) => sum + report.differenceCounts[kind], 0);
  const summary = node("dl");
  for (const [label, value] of [
    ["Compared paths", report.totalPaths],
    ["Confirmed differences", confirmed],
    ["Matching file contents", report.sameFiles],
    ["Matching folders", report.sameDirectories],
    ["Unresolved paths", report.differenceCount - confirmed + report.unassessedOneSide],
  ]) summary.append(node("dt", t(label)), node("dd", number(value)));
  if (report.unassessedOneSide) {
    summary.append(node("dt", t("Paths seen on one side but unassessed on the other")), node("dd", number(report.unassessedOneSide)));
  }
  card.append(summary);
  if (!confirmed) {
    card.append(node("p", t(report.partial || report.differenceCount ?
      "No confirmed differences among the paths checked." : "No differences among the compared paths.")));
  }
  if (report.projectionTruncated || report.rows.length < report.differenceCount) {
    card.append(node("p", t("The report shows {shown} of {total} difference rows.")
      .replace("{shown}", number(report.rows.length)).replace("{total}", number(report.differenceCount))));
  }

  for (const kind of Object.keys(differenceLabels)) {
    const rows = grouped.get(kind);
    if (rows) card.append(showGroup(kind, report.differenceCounts[kind], rows, report.coverageComplete));
  }
  container.append(card);
  return true;
}
