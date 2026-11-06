import { t } from "../../i18n.js";
const LIMIT = 32 * 1024;
const labelName = value => typeof value === "string" ? [...value.split(/[\\/]/u).at(-1)].filter(char => {
  const code = char.codePointAt(0);
  return !(code < 32 || (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069));
}).slice(0, 255).join("") : "";

// Selection never reads bytes. Only the explicit replace action reads the file;
// source or editor changes invalidate its eventual completion.
export function createManifestFileInput({ container, isCurrent, getRevision, onContent, onBusy = () => {} }) {
  const root = document.createElement("section"), input = document.createElement("input"), replace = document.createElement("button");
  const hint = document.createElement("p"), selectedName = document.createElement("p"), status = document.createElement("p");
  root.className = "manifest-file-input"; input.type = "file"; input.className = "ui-input";
  replace.type = "button"; replace.className = "ui-button ui-button--secondary";
  selectedName.setAttribute("translate", "no"); status.setAttribute("role", "status");
  root.append(hint, input, selectedName, replace, status); container.append(root);
  let active = true, selected = null, revision = 0, loading = false, disabled = false, statusKey = "";
  const usable = file => Number.isSafeInteger(file?.size) && file.size >= 1 && file.size <= LIMIT && typeof file.arrayBuffer === "function";
  const sync = () => { input.disabled = disabled || loading; replace.disabled = disabled || loading || !usable(selected); };
  function render() {
    hint.textContent = t("Choose a UTF-8 manifest up to 32 KiB, then replace the text explicitly. Review still requires a separate action.");
    input.setAttribute("aria-label", t("Choose SHA256SUMS file")); replace.textContent = t("Replace manifest with selected file");
    selectedName.textContent = labelName(selected?.name); status.textContent = statusKey ? t(statusKey) : ""; sync();
  }
  input.addEventListener("change", () => {
    if (!active || disabled || loading) return;
    revision++; selected = input.files?.[0] ?? null;
    statusKey = selected && !usable(selected) ? "Manifest file must contain 1–32768 bytes. Existing text was kept." : ""; render();
  });
  replace.addEventListener("click", async () => {
    if (!active || disabled || loading || !isCurrent() || !usable(selected)) return;
    const file = selected, token = ++revision, contentRevision = getRevision();
    const valid = () => active && revision === token && selected === file && isCurrent() && getRevision() === contentRevision;
    loading = true; statusKey = "Reading manifest file…"; render(); onBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      if (!valid()) return;
      if (buffer.byteLength !== file.size || buffer.byteLength > LIMIT) throw new Error("manifest_file_changed");
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
      if (!text.trim()) throw new Error("manifest_file_empty");
      if (!valid()) return;
      onContent(text);
      statusKey = "Manifest loaded. Review has not run yet.";
    } catch { if (valid()) statusKey = "Could not read a valid UTF-8 manifest. Existing text was kept."; }
    finally { if (active && revision === token) { if (!valid() && statusKey === "Reading manifest file…") statusKey = ""; loading = false; onBusy(false); render(); } }
  });
  window.addEventListener("zicode:locale-changed", render); render();
  return {
    setDisabled(value) { disabled = value; sync(); },
    clearNotice() { statusKey = ""; render(); },
    clear() { if (!active) return; revision++; selected = null; input.value = ""; loading = false; statusKey = ""; onBusy(false); render(); },
    destroy() { if (!active) return; active = false; revision++; onBusy(false); window.removeEventListener("zicode:locale-changed", render); root.remove(); },
  };
}
