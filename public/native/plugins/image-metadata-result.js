import { getLocale, t } from "../../i18n.js";
import { IMAGE_METADATA_EXECUTION } from "./resource-save-policy.js";

const CAPABILITIES = new Map([
  ["devtools.image.metadata.inspect", "inspect"], ["devtools.image.metadata.clean", "clean"],
]);
const COUNTS = [
  ["exif", "EXIF"], ["icc", "Color profile (ICC)"], ["xmp", "XMP"],
  ["text", "Text entries"], ["iptc", "IPTC"], ["other", "Other metadata"],
];
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
function metadata(value, format) {
  return value?.format === format && COUNTS.every(([key]) => integer(value[key], 0, 4294967295)) &&
    typeof value.hasExifGpsDirectory === "boolean" &&
    value.hasRecognizedMetadata === (COUNTS.some(([key]) => value[key] > 0) || value.hasExifGpsDirectory) && value.animation === false;
}
function validReport(value, operation) {
  const report = value?.report, source = report?.source, cleaned = report?.cleanedPreview;
  const format = source?.metadata?.format;
  if (value?.ok !== true || value.operation !== operation || report?.schemaVersion !== 2 ||
      report.material !== "image-metadata-report" || !["PNG", "JPEG", "WebP"].includes(format) ||
      !integer(source.bytes, 1, 32 * 1024 * 1024) || !integer(source.displayWidth, 1, 12000) ||
      !integer(source.displayHeight, 1, 12000) || source.displayWidth * source.displayHeight > 16000000 ||
      !metadata(source.metadata, format)) return false;
  if (operation === "inspect") return cleaned === null;
  return integer(cleaned?.bytes, 1, 128 * 1024 * 1024) && cleaned.kind === "encoded-preview" && cleaned.saved === null &&
    metadata(cleaned.metadata, format) && COUNTS.every(([key]) => cleaned.metadata[key] === 0) &&
    cleaned.metadata.hasExifGpsDirectory === false && cleaned.metadata.hasRecognizedMetadata === false &&
    (format === "JPEG" ? integer(cleaned.jpegQuality, 35, 95) : cleaned.jpegQuality === null);
}

// The Host owns report validation. This view reads only the negotiated image report;
// it never interprets provider text as markup or substitutes a thumbnail for a full copy.
export function createImageMetadataResult({ raw, executionProfile, capabilityId, onSaveReport, onNoteReport }) {
  const operation = CAPABILITIES.get(capabilityId);
  if (executionProfile !== IMAGE_METADATA_EXECUTION || !operation) return null;
  const panel = document.createElement("section"); panel.className = "image-metadata-result"; panel.hidden = true;
  const heading = document.createElement("h3"), summary = document.createElement("p"), facts = document.createElement("dl");
  const categories = document.createElement("ul"), notice = document.createElement("p"), details = document.createElement("details");
  const disclosure = document.createElement("summary"), editor = document.createElement("textarea"), select = document.createElement("button");
  const saveReport = document.createElement("button"), saveContainer = document.createElement("div"), saveHint = document.createElement("p");
  const noteReport = document.createElement("button"), noteStatus = document.createElement("p");
  editor.className = "ui-textarea image-metadata-report"; editor.readOnly = true; editor.rows = 8; editor.spellcheck = false; editor.setAttribute("translate", "no");
  select.type = "button"; select.className = "ui-button ui-button--secondary";
  saveReport.type = "button"; saveReport.className = "ui-button ui-button--secondary"; saveReport.hidden = true;
  noteReport.type = "button"; noteReport.className = "ui-button ui-button--secondary"; noteReport.hidden = true;
  noteStatus.setAttribute("role", "status");
  select.addEventListener("click", () => { editor.focus(); editor.select(); });
  const previousHidden = raw.hidden;
  raw.before(panel); raw.setAttribute("translate", "no"); raw.hidden = true; details.append(disclosure, select, saveReport, noteReport, noteStatus, saveHint, editor, raw, saveContainer);
  panel.append(heading, summary, facts, categories, notice, details);
  let active = true, refreshers = [], reportResource = null, reportOwner = null, generation = 0;
  saveReport.addEventListener("click", () => { if (active && reportResource && reportOwner) onSaveReport?.(reportResource, reportOwner, saveContainer); });
  noteReport.addEventListener("click", async () => {
    if (!active || noteReport.disabled || !reportResource || !reportOwner || !onNoteReport) return;
    const captured = generation, resource = reportResource, owner = reportOwner;
    const current = () => active && generation === captured && reportResource === resource && reportOwner === owner;
    noteReport.disabled = true; noteStatus.textContent = t("Preparing note draft…");
    let completed = false;
    try {
      await onNoteReport(resource, owner, current);
      if (current()) { completed = true; noteStatus.textContent = t("Report draft is in Notes recovery. Save it as a new note when ready."); }
    } catch {
      if (current()) noteStatus.textContent = t("Could not create the note draft. Check file access and try again.");
    } finally { if (current()) noteReport.disabled = completed; }
  });
  const number = value => value.toLocaleString(getLocale() === "zh-CN" ? "zh-CN" : "en-US");
  const translated = (element, key) => { const update = () => { element.textContent = t(key); }; refreshers.push(update); update(); };
  const refresh = () => { for (const update of refreshers) update(); };
  window.addEventListener("zicode:locale-changed", refresh);
  function clear() {
    generation++; noteReport.disabled = false; noteReport.hidden = true; noteStatus.textContent = "";
    refreshers = []; panel.hidden = true; details.open = false; raw.textContent = ""; editor.value = "";
    reportResource = reportOwner = null; saveReport.hidden = saveHint.hidden = true;
    facts.replaceChildren(); categories.replaceChildren();
  }
  function fact(label, value) {
    const pair = document.createElement("div"), name = document.createElement("dt"), content = document.createElement("dd");
    translated(name, label); content.setAttribute("translate", "no");
    const update = () => { content.textContent = value(); }; refreshers.push(update); update();
    pair.append(name, content); facts.append(pair);
  }
  function show(value) {
    if (!active) return;
    refreshers = []; facts.replaceChildren(); categories.replaceChildren(); details.open = false; panel.hidden = false;
    translated(heading, "Image metadata result"); translated(disclosure, "View original report"); translated(select, "Select entire report");
    const label = () => { editor.setAttribute("aria-label", t("Original image report")); }; refreshers.push(label); label();
    editor.value = raw.textContent;
    notice.hidden = true;
    if (!validReport(value, operation)) {
      noteReport.hidden = true;
      saveReport.hidden = saveHint.hidden = true;
      translated(summary, value?.ok === false && value.error?.code === "IMAGE_METADATA_FAILED"
        ? "This image could not be processed. Choose a supported static image and try again."
        : "This report cannot be summarized. View the original report for details.");
      return;
    }
    // The selectable document is the report itself, not the execution envelope.
    // Preserve every provider field, including provenance and privacy notes.
    editor.value = JSON.stringify(value.report, null, 2);
    translated(saveReport, "Save report"); saveReport.hidden = !reportResource || !reportOwner || typeof onSaveReport !== "function";
    translated(noteReport, "Create note draft"); noteReport.hidden = !reportResource || !reportOwner || typeof onNoteReport !== "function";
    translated(saveHint, "Direct report saving is unavailable. You can still select and copy the report.");
    saveHint.hidden = !saveReport.hidden || typeof onSaveReport !== "function";
    const source = value.report.source, cleaned = value.report.cleanedPreview;
    translated(summary, operation === "clean" ? "The cleaned copy has no recognized metadata. The original image is unchanged."
      : source.metadata.hasRecognizedMetadata ? "Metadata was found in this image. No metadata values are displayed."
      : "No recognized metadata was found in this image.");
    fact("Image format and size", () => `${source.metadata.format} · ${number(source.displayWidth)} × ${number(source.displayHeight)}`);
    fact("Original file size", () => `${number(source.bytes)} ${t("bytes")}`);
    if (cleaned) {
      fact("Cleaned copy size", () => `${number(cleaned.bytes)} ${t("bytes")}`);
      if (cleaned.jpegQuality !== null) fact("JPEG quality used", () => number(cleaned.jpegQuality));
    }
    for (const [key, label] of COUNTS) {
      if (!source.metadata[key]) continue;
      const item = document.createElement("li"); item.className = "ui-badge";
      const update = () => { item.textContent = `${t(label)} · ${number(source.metadata[key])}`; }; refreshers.push(update); update(); categories.append(item);
    }
    if (source.metadata.hasExifGpsDirectory) {
      const gps = document.createElement("li"); gps.className = "ui-badge";
      translated(gps, "GPS directory detected"); categories.append(gps);
    }
    notice.hidden = false;
    translated(notice, cleaned
      ? "Cleaning re-encodes the image and removes color profiles. Check colors and quality in the preview, then save the full copy separately. Unknown private metadata may not be recognized."
      : "Preview the image orientation below. Unknown private metadata may not be recognized.");
  }
  return { show, clear, setReportResource(resource, owner) { reportResource = resource; reportOwner = owner; }, destroy() {
    if (!active) return; active = false; window.removeEventListener("zicode:locale-changed", refresh);
    refreshers = []; raw.hidden = previousHidden; panel.before(raw); panel.remove();
  } };
}
