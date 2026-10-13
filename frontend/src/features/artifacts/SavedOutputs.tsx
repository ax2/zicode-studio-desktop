import { useCallback, useEffect, useRef, useState } from "react";
// @ts-expect-error shared trusted image parser is plain JavaScript
import { decodeResourceImage } from "../../../../public/native/plugins/plugin-resource-image.js";
import { t } from "../../shared/i18n.js";
import { formatBytes } from "./logic";
import { isBinarySavedOutput, savedOutputExtension } from "./saved-output-formats";
import { type SavedOutput, type SavedOutputGateway, type SavedOutputPage, validSavedOutput } from "./saved-output-types";

export function SavedOutputs({ gateway, getTarget }: {
  gateway?: SavedOutputGateway; getTarget?: () => { sceneId?: string; workspaceId?: string } | null;
}) {
  const [open, setOpen] = useState(false), [page, setPage] = useState<SavedOutputPage | null>(null);
  const [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selected, setSelected] = useState<SavedOutput | null>(null);
  const [preview, setPreview] = useState<{ image?: string; text?: string; notice?: string } | null>(null);
  const life = useRef({ active: true, sequence: 0, controller: null as AbortController | null, url: "" });
  const clear = useCallback(() => {
    life.current.sequence++; life.current.controller?.abort();
    if (life.current.url) URL.revokeObjectURL(life.current.url);
    life.current.url = ""; setPreview(null); setSelected(null);
  }, []);
  useEffect(() => { const state = life.current; state.active = true; return () => {
    state.active = false; state.sequence++; state.controller?.abort();
    if (state.url) URL.revokeObjectURL(state.url); state.url = "";
  }; }, []);
  function request() {
    clear(); const target = getTarget?.(), signature = JSON.stringify(target);
    const scene = target?.sceneId ?? "programming", workspace = target?.workspaceId ?? "";
    const controller = new AbortController(); life.current.controller = controller;
    const sequence = life.current.sequence;
    return { scene, workspace, signal: controller.signal,
      valid: () => life.current.active && sequence === life.current.sequence && signature === JSON.stringify(getTarget?.()) };
  }
  async function load(offset = 0) {
    if (!gateway) return; const scope = request(); setBusy(true); setError("");
    try {
      const result = await gateway.list(scope.scene, scope.workspace, { query, offset, signal: scope.signal });
      if (!scope.valid()) return;
      if (result.schemaVersion !== 1 || result.profile !== "resource.library.draft1" || result.workspaceId !== scope.workspace || result.pageSize !== 40 || result.payloadsRead !== false || !Array.isArray(result.items) || result.items.length > 40 || !result.items.every(item => validSavedOutput(item, scope.workspace))) throw new Error();
      setPage(result);
    } catch { if (scope.valid()) { setPage(null); setError(t("Saved files could not be loaded. Check project access and refresh.")); } }
    finally { if (scope.valid()) setBusy(false); }
  }
  async function read(item: SavedOutput, download: boolean) {
    if (!gateway) return; const scope = request(); setBusy(true); setError("");
    try {
      const receipt = item.receipt;
      if (!validSavedOutput(item, scope.workspace)) throw new Error();
      const limit = download ? 32 * 1024 * 1024 : receipt.mimeType === "text/plain" ? 128 * 1024 : 8 * 1024 * 1024;
      if (receipt.byteLength > limit) throw new Error();
      const bytes = new Uint8Array(await gateway.read(scope.scene, scope.workspace, item, scope.signal));
      if (!scope.valid()) return;
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
      if (!scope.valid() || bytes.length !== receipt.byteLength || hash !== receipt.contentVersion) throw new Error();
      if (download) {
        const extension = savedOutputExtension(receipt.mimeType);
        if (!extension) throw new Error();
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `result-${receipt.saveId}.${extension}`;
        document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
        setSelected(item); setPreview({ notice: t("Verified original file downloaded.") });
      } else if (receipt.mimeType === "text/plain" || isBinarySavedOutput(receipt.mimeType)) {
        setSelected(item); setPreview({ text: receipt.mimeType === "text/plain" ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : [...bytes.subarray(0, 256)].map(b => b.toString(16).padStart(2, "0")).join(" ") });
      } else {
        const result = await decodeResourceImage(bytes, receipt.mimeType, scope.valid) as { blob: Blob };
        if (!scope.valid()) return;
        life.current.url = URL.createObjectURL(result.blob); setSelected(item); setPreview({ image: life.current.url });
      }
    } catch { if (scope.valid()) { clear(); setBusy(false); setPage(null); setError(t("The saved file changed, is unavailable, or access was revoked. Refresh before trying again.")); } }
    finally { if (scope.valid()) setBusy(false); }
  }
  useEffect(() => {
    if (!selected || !gateway) return;
    let active = true; const controller = new AbortController(); const target = getTarget?.(), signature = JSON.stringify(target);
    let timer: ReturnType<typeof setTimeout>;
    const verify = async () => {
      try {
        const result = await gateway.list(target?.sceneId ?? "programming", target?.workspaceId ?? "", { query: selected.receipt.saveId, signal: controller.signal });
        if (active && (signature !== JSON.stringify(getTarget?.()) || !result.items.some(item => item.receiptVersion === selected.receiptVersion))) throw new Error();
      } catch { if (active) { clear(); setBusy(false); setPage(null); setError(t("Saved file access changed. Refresh the library.")); } }
      finally { if (active) timer = setTimeout(verify, 5000); }
    };
    timer = setTimeout(verify, 5000);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [selected, gateway, getTarget, clear]);
  if (!gateway) return null;
  return <section className="saved-outputs ui-panel" aria-label={t("Saved plugin files")}>
    <button type="button" className="ui-button ui-button--secondary" aria-expanded={open} onClick={() => {
      if (open) { clear(); setBusy(false); } else void load(); setOpen(!open);
    }}>{t("Saved plugin files")}</button>
    {open ? <>
      <p>{t("Files you confirmed saving in this project. Download separately; these files are not included in artifact JSON exports.")}</p>
      <form className="saved-outputs-search" onSubmit={event => { event.preventDefault(); void load(); }}>
        <label>{t("Search saved plugin files")}<input className="ui-input" type="search" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button type="submit" disabled={busy} className="ui-button ui-button--secondary">{t("Search")}</button>
      </form>
      <p role="status">{busy ? t("Loading…") : error || (page ? `${page.total} ${t("Files")} · ${t("File contents are verified only when opened.")}` : "")}</p>
      {page?.skippedEntries ? <p>{t("Some incomplete or changed records were skipped. Existing files were kept.")}</p> : null}
      {selected && preview ? <div className="saved-output-preview">
        <strong>{selected.receipt.relativePath}</strong>
        <button type="button" className="ui-button ui-button--secondary" onClick={clear}>{t("Close preview")}</button>
        {preview.notice ? <p>{preview.notice}</p> : preview.image ? <img src={preview.image} alt={t("Saved plugin file preview")} /> : <textarea className="ui-textarea" readOnly rows={8} aria-label={t("Saved plugin file preview")} value={preview.text ?? ""} />}
      </div> : null}
      <ul>{page?.items.map(item => <li key={item.receipt.saveId}>
        <strong>{item.receipt.source.pluginId} · {item.receipt.source.capabilityId}</strong>
        <span>{item.receipt.relativePath}</span><span>{item.receipt.mimeType} · {formatBytes(item.receipt.byteLength)}</span>
        <span>{t("Recorded package version")}: {item.receipt.source.packageVersion}</span>
        <div className="saved-outputs-actions">
          <button type="button" disabled={busy || item.receipt.byteLength > (item.receipt.mimeType === "text/plain" ? 128 * 1024 : 8 * 1024 * 1024)} className="ui-button ui-button--secondary" onClick={() => void read(item, false)}>{t("Preview saved file")}</button>
          <button type="button" disabled={busy} className="ui-button ui-button--secondary" onClick={() => void read(item, true)}>{t("Download saved file")}</button>
        </div>
      </li>)}</ul>
      <div className="saved-outputs-actions">
        <button type="button" className="ui-button ui-button--secondary" disabled={busy || !page || page.offset === 0} onClick={() => void load(Math.max(0, (page?.offset ?? 0) - 40))}>{t("Previous page")}</button>
        <button type="button" className="ui-button ui-button--secondary" disabled={busy || !page?.hasMore} onClick={() => void load((page?.offset ?? 0) + 40)}>{t("Next page")}</button>
      </div>
    </> : null}
  </section>;
}
