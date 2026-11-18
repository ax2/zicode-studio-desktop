import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { NotesSyncRunControl } from "./NotesSyncRunControl";

type Connection = { endpoint: string; username: string; vaultId: string };
type Status = {
  revision: string | null; connection: Connection;
  credentialStorage: "system" | "disabled";
  passwordConfigured: boolean; keyConfigured: boolean;
  state: string; syncAvailable: boolean;
};
type Invoke = (command: string, args: { request: Record<string, unknown> }) => Promise<unknown>;

const statusLabels: Record<string, string> = {
  unconfigured: "Cloud sync is not configured.",
  credentialStorageDisabled: "System credentials are disabled in this isolated profile.",
  credentialsUnavailable: "System credential storage is unavailable. Your saved configuration is kept.",
  credentialsMissing: "Configuration saved. Add the cloud password and recovery code to complete setup.",
  configured: "Configuration and credentials are saved. Sync has not started.",
};
const errors: Record<string, string> = {
  notes_sync_invalid_endpoint: "Enter an HTTPS WebDAV address without embedded credentials, query or fragment.",
  notes_sync_invalid_username: "Enter the WebDAV username.",
  notes_sync_invalid_vault_id: "Enter a valid sync library ID.",
  notes_sync_invalid_password: "The cloud password is too long.",
  notes_sync_invalid_key: "Enter a valid ZNS1 recovery code.",
  notes_sync_settings_changed: "Cloud sync settings changed elsewhere. Refresh before saving again.",
  notes_sync_settings_busy: "Cloud sync settings are in use. Try again shortly.",
  notes_sync_settings_invalid: "Cloud sync settings could not be read safely. The saved files are kept.",
  notes_sync_credentials_disabled: "System credentials are disabled in this isolated profile.",
  notes_sync_credentials_unavailable: "System credential storage is unavailable. Your saved configuration is kept.",
  notes_sync_workspace_unavailable: "The current workspace is unavailable. Reopen cloud sync settings.",
};

export function NotesSyncTab({ getWorkspaceId, getSceneId, invoke }: {
  getWorkspaceId?: () => string | undefined; getSceneId?: () => string; invoke?: Invoke;
}) {
  const native = invoke ?? (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;
  const [status, setStatus] = useState<Status | null>(null);
  const [connection, setConnection] = useState<Connection>({ endpoint: "", username: "", vaultId: "" });
  const [password, setPassword] = useState(""), [recovery, setRecovery] = useState("");
  const [showRecovery, setShowRecovery] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = useRef<string | undefined>(undefined), generation = useRef(0);
  const resetSecrets = useCallback(() => { setPassword(""); setRecovery(""); setShowRecovery(false); }, []);
  const fail = useCallback((value: unknown) => setError(t(errors[String(value).replace(/^Error: /, "")] ?? "Could not read or save cloud sync settings.")), []);
  const accept = useCallback((value: Status) => { setStatus(value); setConnection(value.connection); resetSecrets(); }, [resetSecrets]);

  const load = useCallback(async () => {
    const workspaceId = getWorkspaceId?.(), request = ++generation.current;
    resetSecrets(); setStatus(null); setConnection({ endpoint: "", username: "", vaultId: "" }); setError(""); scope.current = workspaceId;
    if (!native || !workspaceId) { fail("notes_sync_workspace_unavailable"); return; }
    setBusy(true);
    try {
      const value = await native("notes_sync_settings", { request: { kind: "status", workspaceId } }) as Status;
      if (generation.current === request && workspaceId === getWorkspaceId?.()) accept(value);
    } catch (error) { if (generation.current === request) fail(error); }
    finally { if (generation.current === request) setBusy(false); }
  }, [getWorkspaceId, native, resetSecrets, fail, accept]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  async function action(kind: "save" | "newRecoveryCode") {
    if (busy || !native || !status || status.credentialStorage === "disabled") return;
    const workspaceId = getWorkspaceId?.();
    if (!workspaceId || workspaceId !== scope.current) { await load(); return; }
    const request = ++generation.current;
    setBusy(true); setError("");
    try {
      const settings = { expectedRevision: status.revision, connection, password: password || null, recoveryCode: recovery || null };
      const value = await native("notes_sync_settings", { request: { kind, workspaceId, ...(kind === "save" ? { settings } : {}) } });
      if (generation.current !== request) return;
      if (workspaceId !== getWorkspaceId?.()) { await load(); return; }
      if (kind === "save") accept(value as Status);
      else setRecovery((value as { recoveryCode: string }).recoveryCode);
    } catch (error) { if (generation.current === request) fail(error); }
    finally { if (generation.current === request) setBusy(false); }
  }

  const disabled = busy || !status || status.credentialStorage === "disabled";
  const dirty = status && (password || recovery || (["endpoint", "username", "vaultId"] as const).some(key => connection[key] !== status.connection[key]));
  return <section className="settings-section" aria-label={t("Notes cloud sync")}>
    <h2 className="settings-section-title">{t("Notes cloud sync")}</h2>
    <p className="ui-muted">{t(status?.syncAvailable ? "Saving settings never starts sync. Use Sync now to review the destination and sync saved notes." : "Saving these settings does not connect to WebDAV or upload notes. The sync task is not connected yet.")}</p>
    <p role="status">{busy ? t("Loading...") : status ? t(status.syncAvailable && status.state === "configured" ? "Configuration and credentials are saved." : statusLabels[status.state] ?? "Could not read or save cloud sync settings.") : t(error ? "Cloud sync status is unavailable." : "Loading...")}</p>
    {dirty && <p className="ui-muted">{t("Cloud sync settings have unsaved changes.")}</p>}
    {error && <p role="alert">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); void action("save"); }}>
      <fieldset disabled={disabled}>
        {([ ["endpoint", "WebDAV address"], ["username", "WebDAV username"], ["vaultId", "Sync library ID"] ] as const).map(([key, label]) =>
          <label className="settings-row" key={key}>
            <span className="settings-label">{t(label)}</span>
            <input className="ui-input" value={connection[key]} autoComplete="off" translate="no" onChange={event => setConnection(current => ({ ...current, [key]: event.target.value }))} />
          </label>)}
        <p className="ui-muted">{t("Use the same library ID and recovery code on another device. Create a recovery code only for a new cloud library.")}</p>
        <label className="settings-row"><span className="settings-label">{t("Cloud password")}</span>
          <input className="ui-input" type="password" value={password} autoComplete="new-password" onChange={event => setPassword(event.target.value)} /></label>
        <label className="settings-row"><span className="settings-label">{t("Recovery code")}</span>
          <input className="ui-input" type={showRecovery ? "text" : "password"} value={recovery} autoComplete="off" translate="no" onChange={event => setRecovery(event.target.value)} /></label>
        <label><input type="checkbox" checked={showRecovery} onChange={event => setShowRecovery(event.target.checked)} /> {t("Show recovery code")}</label>
        <button type="button" className="ui-button ui-button--secondary" disabled={status?.keyConfigured} onClick={() => void action("newRecoveryCode")}>{t("Create recovery code")}</button>
        <p className="ui-muted">{t("Keep your recovery code safely. Stored passwords and recovery codes are never shown again. Blank fields keep stored credentials only when the connection details are unchanged.")}</p>
        {status?.credentialStorage === "system" && status.state !== "credentialsUnavailable" && <p>{t(status.passwordConfigured ? "Cloud password is stored." : "Cloud password is missing.")} {t(status.keyConfigured ? "Recovery key is stored." : "Recovery key is missing.")}</p>}
        <button type="submit" className="ui-button ui-button--primary">{t("Save cloud sync settings")}</button>
      </fieldset>
    </form>
    <button type="button" className="ui-button ui-button--secondary" disabled={busy} onClick={() => void load()}>{t("Refresh")}</button>
    {status?.syncAvailable && <NotesSyncRunControl workspaceId={scope.current} revision={status.revision} connection={status.connection}
      ready={status.state === "configured" && !disabled && !dirty} getWorkspaceId={getWorkspaceId} getSceneId={getSceneId} onRefreshSettings={load} invoke={native} />}
  </section>;
}
