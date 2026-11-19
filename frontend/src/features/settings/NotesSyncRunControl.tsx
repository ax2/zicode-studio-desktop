import { notifyNotesSyncLocalChange } from "../../shared/notes-sync-refresh";
import { NotesSyncConflictsReview } from "./NotesSyncConflictsReview";
import type { ConflictApplied } from "./notes-sync-conflict-state";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { type NotesSyncRunStatus, notesSyncMessage, parseNotesSyncRunStatus } from "./notes-sync-task-state";

export interface SavedSyncConnection { endpoint: string; username: string; vaultId: string }
type Invoke = (command: string, args: { request: Record<string, unknown> }) => Promise<unknown>;
type Confirmation = { workspaceId: string; sceneId: string; revision: string; endpoint: string; username: string; vaultId: string };

export function NotesSyncRunControl({ workspaceId, revision, connection, ready, getWorkspaceId, getSceneId, onRefreshSettings, invoke }: {
  workspaceId?: string; revision: string | null; connection: SavedSyncConnection; ready: boolean;
  getWorkspaceId?: () => string | undefined; getSceneId?: () => string;
  onRefreshSettings?: () => void | Promise<void>; invoke?: Invoke;
}) {
  const native = invoke ?? (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
  const sceneId = getSceneId?.() || "programming";
  const [status, setStatus] = useState<NotesSyncRunStatus | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState<"status" | "start" | "cancel" | null>(null);
  const [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false), [localProof, setLocalProof] = useState<ConflictApplied | null>(null);
  const generation = useRef(0), requestVersion = useRef(0);
  const current = useCallback(() => Boolean(workspaceId && (getWorkspaceId ? getWorkspaceId() : workspaceId) === workspaceId
    && (getSceneId?.() || "programming") === sceneId), [getWorkspaceId, getSceneId, workspaceId, sceneId]);

  const readStatus = useCallback(async () => {
    if (!native || !workspaceId || !current()) {
      setError(t("Workspace or scene changed. Refresh cloud sync settings.")); return;
    }
    const epoch = generation.current, version = ++requestVersion.current;
    setBusy("status"); setError("");
    try {
      const value = parseNotesSyncRunStatus(await native("notes_sync_task", { request: { kind: "status", workspaceId, sceneId } }));
      if (generation.current === epoch && version === requestVersion.current && current()) { setStatus(value); if (value.running) setConfirmation(null); }
    } catch {
      if (generation.current === epoch && version === requestVersion.current) setError(t("Could not read sync status. Refresh sync status to try again."));
    } finally {
      if (generation.current === epoch && version === requestVersion.current) setBusy(null);
    }
  }, [native, workspaceId, sceneId, current]);

  useEffect(() => {
    generation.current++; requestVersion.current++;
    setStatus(null); setConfirmation(null); setError(""); setBusy(null); setReviewOpen(false); setLocalProof(null);
    void readStatus();
    return () => { generation.current++; requestVersion.current++; };
  }, [readStatus]);
  useEffect(() => { if (!ready) setConfirmation(null); }, [ready]);
  useEffect(() => {
    if (!status?.running || busy || error) return;
    const timer = setTimeout(() => { void readStatus(); }, 750);
    return () => clearTimeout(timer);
  }, [status, busy, error, readStatus]);

  const matchesConfirmation = () => confirmation && confirmation.workspaceId === workspaceId && confirmation.sceneId === sceneId
    && confirmation.revision === revision && confirmation.endpoint === connection.endpoint
    && confirmation.username === connection.username && confirmation.vaultId === connection.vaultId;
  const startAllowed = ready && native && revision && status && !status.running && !busy && !error && current();

  async function action(kind: "start" | "cancel") {
    if (!native || !workspaceId || !current()) {
      setConfirmation(null); setError(t("Workspace or scene changed. Refresh cloud sync settings.")); return;
    }
    if (busy === "start" || busy === "cancel") return;
    if (kind === "start" && (!startAllowed || !matchesConfirmation())) return;
    if (kind === "cancel" && (!status?.running || !status.runId)) return;
    const epoch = generation.current, version = ++requestVersion.current;
    setBusy(kind); setError(""); setConfirmation(null); setReviewOpen(false); setLocalProof(null);
    try {
      const value = parseNotesSyncRunStatus(await native("notes_sync_task", { request: {
        kind, workspaceId, sceneId, ...(kind === "start" ? { revision, confirmed: true } : { runId: status?.runId }),
      } }));
      if (generation.current === epoch && version === requestVersion.current && current()) { setStatus(value); if (value.running) setConfirmation(null); }
    } catch {
      if (generation.current === epoch && version === requestVersion.current) setError(t("Could not start or cancel sync. Refresh settings and check Notes permissions."));
    } finally {
      if (generation.current === epoch && version === requestVersion.current) setBusy(null);
    }
  }

  async function refresh() {
    if (busy) return;
    if (!current() && onRefreshSettings) { try { await onRefreshSettings(); } catch { setError(t("Could not read sync status. Refresh sync status to try again.")); } return; }
    await readStatus();
  }
  const proofIsCurrent = Boolean(localProof && localProof.runId === status?.runId && localProof.revision === revision && current());
  return <section className="settings-section" aria-label={t("Manual notes sync")}>
    {status && !status.running && status.state !== "idle" && <h3 className="settings-section-title">{t("Last sync result")}</h3>}
    <p role="status">{error ? t("Sync status is unavailable.") : status ? t(status.state === "conflicts" && status.conflictsAvailable ? "Conflicting changes are kept. Review each version to choose what to save." : notesSyncMessage(status.state)) : t("Loading...")}</p>
    {status?.state === "rateLimited" && status.retryAfterSeconds !== null && <p>{t("Server requested a wait of {seconds} seconds. Retry manually after the wait.").replace("{seconds}", String(status.retryAfterSeconds))}</p>}
    {status?.state === "conflicts" && <p>{t("Conflicting records: {count}").replace("{count}", String(status.conflictCount))}</p>}
    {error && <p role="alert">{error}</p>}
    <p className="ui-muted">{t("Only saved notebooks, notes, attachments and deletion records are synced. Drafts and Studio credentials stay local. Saving settings never starts sync.")}</p>
    <p className="ui-muted">{t("Leaving settings does not cancel sync. Exiting Studio stops the current run; resuming requires another explicit sync.")}</p>
    {status?.running ? <button type="button" className="ui-button ui-button--secondary" disabled={busy === "start" || busy === "cancel"} onClick={() => void action("cancel")}>{t("Cancel sync")}</button> :
      <button type="button" className="ui-button ui-button--primary" disabled={!startAllowed} onClick={() => {
        if (startAllowed && workspaceId && revision) setConfirmation({ workspaceId, sceneId, revision, ...connection });
      }}>{t("Sync now")}</button>}
    <button type="button" className="ui-button ui-button--secondary" disabled={Boolean(busy)} onClick={() => void refresh()}>{t("Refresh sync status")}</button>
    {localProof && proofIsCurrent && <div role="status">
      {status?.state !== "resolvedLocally" && <p>{t("Conflict choices are saved on this device and are waiting to upload. Use Sync now to upload them.")}</p>}
      <p>{t("Conflict copies: {notes} notes in {notebooks} notebooks.").replace("{notes}", String(localProof.copiedNotes)).replace("{notebooks}", String(localProof.copiedNotebooks))}</p>

    </div>}
    {(proofIsCurrent || status?.state === "resolvedLocally") && <button type="button" className="ui-button ui-button--secondary" disabled={!current()} onClick={() => { if (workspaceId && current()) notifyNotesSyncLocalChange(workspaceId); }}>{t("Refresh notes list")}</button>}
    {status?.state === "conflicts" && status.conflictsAvailable && status.runId && revision && workspaceId && native && !proofIsCurrent && <>
      <button type="button" className="ui-button ui-button--secondary" disabled={!ready || Boolean(busy) || !current()} onClick={() => setReviewOpen(true)}>{t("Resolve sync conflicts")}</button>
      {reviewOpen && <NotesSyncConflictsReview key={JSON.stringify([workspaceId, sceneId, status.runId, revision])}
        scope={{ workspaceId, sceneId, runId: status.runId, revision }} enabled={ready && !busy} current={current} invoke={native} libraryId={connection.vaultId}
        onClose={() => setReviewOpen(false)} onApplied={result => { setLocalProof(result); notifyNotesSyncLocalChange(workspaceId); void readStatus(); }} />}
    </>}
    {confirmation && ready && matchesConfirmation() && !status?.running && <div className="ui-panel">
      <p>{t("Sync saved notes with this WebDAV destination?")}</p>
      <dl><dt>{t("WebDAV address")}</dt><dd translate="no">{connection.endpoint}</dd>
        <dt>{t("WebDAV username")}</dt><dd translate="no">{connection.username}</dd>
        <dt>{t("Sync library ID")}</dt><dd translate="no">{connection.vaultId}</dd></dl>
      <p>{t("Cloud changes may be merged into local saved notes. Conflicts will be kept without choosing a side.")}</p>
      <button type="button" className="ui-button ui-button--primary" disabled={Boolean(busy) || !startAllowed} onClick={() => void action("start")}>{t("Confirm and sync")}</button>
      <button type="button" className="ui-button ui-button--secondary" onClick={() => setConfirmation(null)}>{t("Cancel")}</button>
    </div>}
  </section>;
}
