import { useState } from "react";
import { t } from "../../shared/i18n";

type Connection = { endpoint: string; username: string; vaultId: string };
type Entry = { revision: string; archivedAt: number; connection: Connection };
type Props = {
  workspace: string;
  current: Connection;
  invoke: (command: string, args: { request: Record<string, unknown> }) => Promise<unknown>;
  disabled: boolean;
  restore: (revision: string) => void;
};

export function NotesSyncHistory({ workspace, current, invoke, disabled, restore }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  async function open() {
    setLoading(true);
    setFailed(false);
    try {
      setEntries(await invoke("notes_sync_settings", { request: { kind: "history", workspaceId: workspace } }) as Entry[]);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }
  function close() { setSelected(null); setEntries(null); }
  return <section aria-label={t("Sync settings history")}>
    <button type="button" className="ui-button ui-button--secondary" aria-expanded={entries !== null} disabled={loading}
      onClick={() => entries === null ? void open() : close()}>{t("Sync settings history")}</button>
    {failed && <p role="alert">{t("Could not load sync settings history.")}</p>}
    {entries?.length === 0 && <p>{t("No earlier sync settings.")}</p>}
    {entries && entries.length > 0 && <label className="settings-row">{t("Archived settings")}
      <select value={selected?.revision ?? ""} onChange={event => setSelected(entries.find(entry => entry.revision === event.target.value) ?? null)}>
        <option value="">{t("Select a version to preview")}</option>
        {entries.map(entry => <option key={entry.revision} value={entry.revision}>{new Date(entry.archivedAt).toLocaleString()} · {entry.connection.endpoint} · {entry.revision.slice(0, 8)}</option>)}
      </select></label>}
    {selected && <section aria-label={t("Review local restore")}>
      <table><thead><tr><th>{t("Setting")}</th><th>{t("Current settings")}</th><th>{t("Restore target")}</th></tr></thead>
        <tbody>{([["endpoint","WebDAV address"],["username","WebDAV username"],["vaultId","Sync library ID"]] as const).map(([key,label]) =>
          <tr key={key}><th scope="row">{t(label)}</th><td>{current[key]}</td><td>{selected.connection[key]}</td></tr>)}</tbody></table>
      <p>{t("Restore this connection and its stored credential references on this device? Sync will start only when you request it.")}</p>
      <button type="button" className="ui-button ui-button--secondary" onClick={() => setSelected(null)}>{t("Cancel")}</button>
      <button type="button" className="ui-button ui-button--primary" disabled={disabled} onClick={() => restore(selected.revision)}>{t("Confirm local restore")}</button>
    </section>}
  </section>;
}
