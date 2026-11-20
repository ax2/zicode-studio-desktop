import { t } from "../../shared/i18n";
import type { ConflictRow, ConflictSide } from "./notes-sync-conflict-state";

export function conflictTitle(row: ConflictRow): string {
  if (row.kind === "order") return t("Notebook order");
  return row.local.title || row.remote.title || t(row.kind === "book" ? "Notebook" : row.kind === "note" ? "Note" : "Attachment");
}
export function ConflictVersion({ label, side, attachment = false }: { label: string; side: ConflictSide; attachment?: boolean }) {
  return <section className="ui-panel notes-sync-conflict-version" aria-label={t(label)}>
    <h5 className="settings-section-title">{t(label)}</h5>
    <p>{t(side.deleted ? "This version is deleted." : !side.exists ? "No version exists here." : "This version is present.")}</p>
    {side.title && <p translate="no">{side.title}</p>}
    <dl className="notes-sync-conflict-meta">
      {side.byteLength !== undefined && <><dt>{t("Bytes")}</dt><dd>{side.byteLength}</dd></>}
      {side.sha256 && <><dt>SHA-256</dt><dd translate="no">{side.sha256}</dd></>}
    </dl>
    {attachment ? <p className="ui-muted">{t("Attachment contents are not opened in this comparison. Compare the size and SHA-256.")}</p> :
      side.text !== undefined && <div className="notes-sync-conflict-body" translate="no">{side.text || t("Empty text")}</div>}
    {side.properties !== undefined && <details><summary>{t("Properties")}</summary>
      <div className="notes-sync-conflict-body" translate="no">{side.properties || t("No properties")}</div></details>}
  </section>;
}
export function NotesSyncConflictVersions({ item }: { item: ConflictRow }) {
  return <section aria-label={t("Compare conflict versions")}>
    <h4 className="settings-section-title" translate="no">{conflictTitle(item)}</h4>
    <div className="notes-sync-conflict-versions">
      <ConflictVersion label="Local version" side={item.local} attachment={item.kind === "attachment"} />
      <ConflictVersion label="Cloud version" side={item.remote} attachment={item.kind === "attachment"} />
    </div>
  </section>;
}
