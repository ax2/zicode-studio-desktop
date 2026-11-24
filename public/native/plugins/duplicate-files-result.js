import { getLocale, t } from "../../i18n.js";

const pluginId = "com.zicode.devtools.duplicate-files";
const capabilityId = "devtools.duplicate-files.scan";
export const duplicateFilesPermission = "resource.directory.duplicates.read";
export const duplicateFilesProfile = "resource.local-directory.duplicates.draft1";

export function isDuplicateFiles(plugin, capability) {
  return plugin === pluginId && capability === capabilityId;
}

const decimal = value => typeof value === "string" && /^(0|[1-9][0-9]{0,19})$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 4096;
const digest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const format = value => Number(value).toLocaleString(getLocale());
const bytes = value => t("{bytes} B").replace("{bytes}", BigInt(value).toLocaleString(getLocale()));

function relativePath(value) {
  return typeof value === "string" && !/[\\:\p{Cc}]/u.test(value) &&
    value.split("/").every(part => part && part !== "." && part !== "..") &&
    new TextEncoder().encode(value).length <= 2048;
}
function element(tag, label) {
  const node = document.createElement(tag);
  if (label !== undefined) node.textContent = label;
  return node;
}
const limits = {
  entries: "Entry limit reached.",
  time: "Scan time limit reached.",
  candidate_files: "Duplicate candidate limit reached.",
  hash_bytes: "Candidate file read budget reached.",
  snapshot_bytes: "Directory snapshot size limit reached.",
};

export function renderDuplicateFilesResult(container, report) {
  container.replaceChildren();
  const source = report?.source;
  if (report?.ok !== true || report.schemaVersion !== 1 || report.material !== "duplicate-files-report" ||
      !source || typeof report.partial !== "boolean" || source.partial !== report.partial ||
      typeof report.projectionTruncated !== "boolean" ||
      !decimal(report.redundantBytes) || !count(report.groupCount) || report.groupCount > 128 ||
      !count(report.duplicateFileCount) || report.duplicateFileCount > 256 || !count(source.hashedFiles) || source.hashedFiles > 256 ||
      report.duplicateFileCount > source.hashedFiles ||
      !Array.isArray(report.groups) || report.groups.length > Math.min(20, report.groupCount) ||
      !report.groups.every(group => decimal(group?.logicalBytes) && decimal(group.redundantBytes) && digest(group.sha256) &&
        count(group.fileCount) && group.fileCount >= 2 && group.fileCount <= report.duplicateFileCount &&
        Array.isArray(group.paths) && group.paths.length <= Math.min(12, group.fileCount) &&
        group.paths.every(relativePath))) return false;

  const card = element("div"); card.className = "tool-result";
  const summary = element("dl");
  for (const [label, value] of [
    ["Hashed candidate files", format(source.hashedFiles)],
    ["Duplicate groups", format(report.groupCount)],
    ["Matching files", format(report.duplicateFileCount)],
    ["Potential duplicate logical size", bytes(report.redundantBytes)],
  ]) summary.append(element("dt", t(label)), element("dd", value));
  card.append(summary);
  if (report.partial) {
    card.append(element("p", t("This duplicate check is partial. The report covers only files that were checked.")));
    if (Object.hasOwn(limits, source.limitReason)) card.append(element("p", t(limits[source.limitReason])));
    for (const [field, label] of [
      ["skippedLinks", "Skipped links: {count}"],
      ["skippedDepth", "Beyond the scan depth: {count}"],
      ["skippedNames", "Unsupported names: {count}"],
      ["unreadable", "Unreadable entries: {count}"],
      ["changedFiles", "Files that changed: {count}"],
      ["skippedBudget", "Candidates beyond the budget: {count}"],
    ]) {
      if (count(source[field]) && source[field] > 0) {
        card.append(element("p", t(label).replace("{count}", format(source[field]))));
      }
    }
  }
  if (!report.groupCount) card.append(element("p", t("No duplicate files were found among the checked files.")));
  for (const group of report.groups) {
    const section = element("details");
    section.append(element("summary", t("{count} files of {size} each")
      .replace("{count}", format(group.fileCount)).replace("{size}", bytes(group.logicalBytes))));
    const hash = element("p");
    hash.append("SHA-256 · ", element("code", group.sha256));
    section.append(hash);
    const list = element("ul");
    for (const path of group.paths) {
      const item = element("li");
      item.append(element("bdi", path));
      list.append(item);
    }
    section.append(list);
    if (group.paths.length < group.fileCount) section.append(element("p", t("Some paths in this group are omitted.")));
    card.append(section);
  }
  if (report.projectionTruncated) card.append(element("p", t("The report lists only part of the matches.")));
  container.append(card);
  return true;
}
