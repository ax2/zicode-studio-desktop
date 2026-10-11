import { useEffect, useRef, useState } from "react";
// @ts-expect-error shared trusted recovery verifier is plain JavaScript
import { verifySavedResource } from "../../../../public/native/plugins/plugin-resource-save-recovery.js";
import { t } from "../../shared/i18n.js";
import { type SaveAttempt, type SaveAttemptPage, type SavedOutputGateway, validSaveAttemptPage } from "./saved-output-types";

export function SaveAttempts({ gateway, getTarget }: {
  gateway?: SavedOutputGateway; getTarget?: () => { sceneId?: string; workspaceId?: string } | null;
}) {
  const [open, setOpen] = useState(false), [page, setPage] = useState<SaveAttemptPage | null>(null);
  const [query, setQuery] = useState(""), [busy, setBusy] = useState(false), [status, setStatus] = useState("");
  const [checkedId, setCheckedId] = useState("");
  const life = useRef({ active: true, sequence: 0, controller: null as AbortController | null });
  function stop() { life.current.sequence++; life.current.controller?.abort(); }
  useEffect(() => {
    const state = life.current; state.active = true;
    return () => { state.active = false; state.sequence++; state.controller?.abort(); };
  }, []);
  function request() {
    stop(); const signature = JSON.stringify(getTarget?.()), target = getTarget?.();
    const controller = new AbortController(); life.current.controller = controller;
    const sequence = life.current.sequence;
    return { sceneId: target?.sceneId ?? "programming", workspaceId: target?.workspaceId ?? "", signal: controller.signal,
      valid: () => life.current.active && sequence === life.current.sequence && signature === JSON.stringify(getTarget?.()) };
  }
  async function load(offset = 0) {
    if (!gateway?.attempts) return;
    const scope = request(); setBusy(true); setStatus(""); setCheckedId(""); setPage(null);
    try {
      const result = await gateway.attempts(scope.sceneId, scope.workspaceId, { query, offset, signal: scope.signal });
      if (!scope.valid()) return;
      if (!validSaveAttemptPage(result, scope.workspaceId, offset)) throw new Error();
      setPage(result);
    } catch { if (scope.valid()) setStatus(t("Save records could not be loaded. Check project access or Host support.")); }
    finally { if (scope.valid()) setBusy(false); }
  }
  async function check(item: SaveAttempt) {
    if (!gateway) return;
    const scope = request(); setBusy(true); setCheckedId(""); setStatus(t("Checking saved file…"));
    try {
      await verifySavedResource({ gateway, expected: structuredClone(item.receipt), ...scope });
      if (scope.valid()) { setCheckedId(item.receipt.saveId); setStatus(t("Verified saved file: {path}").replace("{path}", item.receipt.relativePath)); }
    } catch {
      if (scope.valid()) setStatus(t("The saved file could not be verified. The save may still have completed. Check the original project before saving again; no write was retried."));
    } finally { if (scope.valid()) setBusy(false); }
  }
  // Recheck access without reading payloads; clear stale records after revocation.
  useEffect(() => {
    if (!open || !gateway?.attempts) return;
    let active = true, polling = false; const signature = JSON.stringify(getTarget?.()), target = getTarget?.();
    const controller = new AbortController();
    const timer = setInterval(async () => {
      if (signature !== JSON.stringify(getTarget?.())) {
        life.current.sequence++; life.current.controller?.abort(); setPage(null); setStatus(""); setBusy(false); setOpen(false); return;
      }
      if (polling) return; polling = true;
      try {
        await gateway.attempts?.(target?.sceneId ?? "programming", target?.workspaceId ?? "", { signal: controller.signal });
      } catch {
        if (active) { life.current.sequence++; life.current.controller?.abort(); setPage(null); setBusy(false); setStatus(t("Save records could not be loaded. Check project access or Host support.")); }
      } finally { polling = false; }
    }, 5000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [open, gateway, getTarget]);
  if (!gateway?.attempts) return null;
  return <section className="saved-outputs ui-panel">
    <button type="button" className="ui-button ui-button--secondary" aria-expanded={open} onClick={() => {
      stop(); setPage(null); setBusy(false); setStatus(""); setOpen(!open); if (!open) void load();
    }}>{t("Review save records")}</button>
    {open ? <>
      <p>{t("Records survive closing the tool. Publication metadata does not prove file integrity or that an unfinished save stopped. Checks only read files; nothing is retried or deleted.")}</p>
      <form className="saved-outputs-search" onSubmit={event => { event.preventDefault(); if (!busy) void load(); }}>
        <label><span>{t("Search save records")}</span><input className="ui-input" type="search" value={query} maxLength={120} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
        <button type="submit" className="ui-button ui-button--secondary" disabled={busy}>{t("Search")}</button>
      </form>
      <p role="status">{busy ? t("Loading…") : status || (page ? `${page.total} ${t("Save records")}` : "")}</p>
      {page?.skippedEntries ? <p>{t("Some incomplete or changed records were skipped. Existing files were kept.")}</p> : null}
      <ul>{page?.items.map(item => <li key={item.receipt.saveId}>
        <strong>{item.receipt.source.pluginId} · {item.receipt.source.capabilityId}</strong>
        <span>{item.receipt.relativePath}</span><span>{item.receipt.mimeType} · {item.receipt.byteLength} {t("bytes")}</span>
        <span>{checkedId === item.receipt.saveId ? t("Snapshot verified at the last check; later changes are possible.") : item.publication === "observed" ? t("Publication record found; file contents are not checked.") : t("Publication not observed; the save outcome is uncertain.")}</span>
        <div className="saved-outputs-actions"><button type="button" className="ui-button ui-button--secondary" disabled={busy} onClick={() => void check(item)}>{t("Check saved file")}</button></div>
      </li>)}</ul>
      <div className="saved-outputs-actions">
        <button type="button" className="ui-button ui-button--secondary" disabled={busy || !page || page.offset === 0} onClick={() => void load(Math.max(0, (page?.offset ?? 0) - 40))}>{t("Previous page")}</button>
        <button type="button" className="ui-button ui-button--secondary" disabled={busy || !page?.hasMore} onClick={() => void load((page?.offset ?? 0) + 40)}>{t("Next page")}</button>
      </div>
    </> : null}
  </section>;
}
