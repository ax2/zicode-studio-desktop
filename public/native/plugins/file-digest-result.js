import { t } from "../../i18n.js";
import { fileDigestComparison } from "./file-digest-comparison.js";

const PROFILE = "resource.wasi.file-digest.v1";
const CAPABILITY = "devtools.files.hash";
const hex = (value, length) => typeof value === "string" && value.length === length && /^[0-9a-f]+$/.test(value);
const safeName = value => typeof value === "string"
  ? [...value.split(/[\\/]/u).at(-1)].filter(char => {
    const code = char.codePointAt(0);
    return !(code < 32 || (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069));
  }).slice(0, 255).join("") : "";

// Host validation binds the row order, lengths and SHA-256 to the shared snapshots.
export function createFileDigestResult({ raw, executionProfile, capabilityId, onNoteReport }) {
  if (executionProfile !== PROFILE || capabilityId !== CAPABILITY) return null;
  const panel = document.createElement("section"), heading = document.createElement("h3"), rows = document.createElement("div");
  const details = document.createElement("details"), summary = document.createElement("summary"), comparison = document.createElement("p");
  const note = document.createElement("button"), noteStatus = document.createElement("p");
  note.type = "button"; note.className = "ui-button ui-button--secondary"; note.hidden = true;
  noteStatus.setAttribute("role", "status");
  panel.className = "file-digest-result"; panel.hidden = true;
  const originalHidden = raw.hidden;
  raw.before(panel); details.append(summary, raw); panel.append(heading, comparison, rows, note, noteStatus, details); raw.hidden = false;
  let active = true, current = null, names = [], currentInput = {}, comparisonValue = null, generation = 0;
  note.addEventListener("click", async () => {
    if (!active || !current || note.disabled || !onNoteReport) return;
    const captured = generation, value = current, selectedNames = [...names];
    const isCurrent = () => active && generation === captured && current === value;
    note.disabled = true; noteStatus.textContent = t("Preparing note draft…");
    let completed = false;
    try {
      await onNoteReport(value, selectedNames, currentInput, isCurrent);
      if (isCurrent()) { completed = true; noteStatus.textContent = t("Report draft is in Notes recovery. Save it as a new note when ready."); }
    } catch {
      if (isCurrent()) noteStatus.textContent = t("Could not create the note draft. Check file access and try again.");
    } finally { if (isCurrent()) note.disabled = completed; }
  });
  function valid(value) {
    return value?.ok === true && value.schemaVersion === 2 && value.material === "file-integrity-report-list" &&
      Array.isArray(value.files) && value.files.length >= 1 && value.files.length <= 4 &&
      value.files.every((row, index) => row?.index === index && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 33554432 &&
        hex(row.sha256, 64) && hex(row.sha512, 128) && [null, true, false].includes(row.matches));
  }
  function render() {
    if (!active || !current) return;
    heading.textContent = t("File digest results"); summary.textContent = t("View original report"); note.textContent = t("Create note draft"); rows.replaceChildren();
    comparison.textContent = comparisonValue ? `${t("Expected digest")} (${comparisonValue.algorithm}): ${comparisonValue.expected}` : t("No expected digest provided");
    comparison.setAttribute("translate", "no");
    for (const row of current.files) {
      const section = document.createElement("section"), title = document.createElement("h4"), status = document.createElement("p"), list = document.createElement("dl");
      title.textContent = `${t("File {number}").replace("{number}", String(row.index + 1))}${names[row.index] ? ` · ${names[row.index]}` : ""}`;
      status.textContent = `${row.bytes.toLocaleString()} ${t("bytes")} · ${t(row.matches === null ? "No expected digest provided" : row.matches ? "Digest matches" : "Digest does not match")}`;
      for (const [name, value] of [["SHA-256", row.sha256], ["SHA-512", row.sha512]]) {
        const item = document.createElement("div"), label = document.createElement("dt"), digest = document.createElement("dd");
        label.textContent = name; digest.textContent = value; digest.setAttribute("translate", "no"); item.append(label, digest); list.append(item);
      }
      section.append(title, status, list); rows.append(section);
    }
  }
  window.addEventListener("zicode:locale-changed", render);
  return {
    show(value, displayNames = [], input = {}) { generation++; note.disabled = false; noteStatus.textContent = ""; current = valid(value) ? value : null;
      currentInput = { expected: input?.expected ?? "" }; comparisonValue = null;
      try { if (current) comparisonValue = fileDigestComparison(currentInput, current.files); } catch { current = null; }
      note.hidden = !current || typeof onNoteReport !== "function";
      names = current && Array.isArray(displayNames) && displayNames.length === current.files.length ? displayNames.map(safeName) : [];
      panel.hidden = false; raw.hidden = false; details.open = !current;
      if (current) render(); else { heading.textContent = t("File digest results"); summary.textContent = t("View original report"); comparison.textContent = ""; rows.replaceChildren(); } },
    clear() { generation++; note.disabled = false; note.hidden = true; noteStatus.textContent = ""; current = null; names = []; currentInput = {}; comparisonValue = null; comparison.textContent = ""; panel.hidden = true; raw.hidden = false; rows.replaceChildren(); },
    destroy() { if (!active) return; active = false; window.removeEventListener("zicode:locale-changed", render); raw.hidden = originalHidden; panel.before(raw); panel.remove(); },
  };
}
