import { t } from "../../shared/i18n";
import { ConflictVersion, conflictTitle, NotesSyncConflictVersions } from "./NotesSyncConflictVersions";
import { type ConflictApplied, type ConflictChoice, type ConflictInvoke, type ConflictScope } from "./notes-sync-conflict-state";
import { useNotesSyncConflicts } from "./useNotesSyncConflicts";

export const conflictChoiceLabels: Record<ConflictChoice, string> = { local: "Keep local", remote: "Keep cloud", both: "Keep both" };
export function NotesSyncConflictsReview({ scope, enabled, current, invoke, libraryId, onApplied, onClose }: {
  scope: ConflictScope; enabled: boolean; current: () => boolean; invoke: ConflictInvoke; libraryId: string;
  onApplied: (result: ConflictApplied) => void; onClose: () => void;
}) {
  const review = useNotesSyncConflicts(scope, enabled, current, invoke, onApplied);
  const selectedCounts = { local: 0, remote: 0, both: 0 };
  for (const choice of review.selected.values()) selectedCounts[choice]++;
  return <section className="settings-section notes-sync-conflicts" aria-label={t("Resolve sync conflicts")} aria-busy={review.busy}>
    <h3 className="settings-section-title">{t("Resolve sync conflicts")}</h3>
    <p className="ui-muted">{t("Compare each version and choose explicitly. Keep both saves the other version in a separate conflict notebook with its attachments, preserving the current notes.")}</p>
    <p className="ui-muted">{t("These versions were captured by this sync conflict. Reviewing and saving choices do not connect to the cloud; the next manual sync checks any newer cloud changes again.")}</p>
    {!enabled && <p role="alert">{t("Save or discard unsaved cloud sync settings before reviewing conflicts.")}</p>}
    {review.failure && <p role="alert">{t(review.failure.message)}</p>}
    {review.busy && <p role="status">{t("Loading...")}</p>}
    {review.applied ? <div role="status">
      <p>{t("Conflict choices are saved on this device and are waiting to upload. Use Sync now to upload them.")}</p>
      <p>{t("Conflict copies: {notes} notes in {notebooks} notebooks.").replace("{notes}", String(review.applied.copiedNotes)).replace("{notebooks}", String(review.applied.copiedNotebooks))}</p>
    </div> : <>
      {review.pages.length > 0 && <p role="status">{t("Choices: {selected} / {total}").replace("{selected}", String(review.selected.size)).replace("{total}", String(review.total))}</p>}
      {review.page?.total === 0 && <p>{t("There are no conflicts to resolve in this review.")}</p>}
      <div className="notes-sync-conflict-list">
        {review.page?.rows.map(row => <fieldset key={row.id} className="ui-panel" disabled={!review.canUse}>
          <legend translate="no">{conflictTitle(row)}</legend>
          {row.notebookTitle && <p><span>{t("Notebook")}: </span><span translate="no">{row.notebookTitle}</span></p>}
          <div className="notes-sync-conflict-versions">
            <ConflictVersion label="Local version" side={{ ...row.local, text: undefined, properties: undefined }} />
            <ConflictVersion label="Cloud version" side={{ ...row.remote, text: undefined, properties: undefined }} />
          </div>
          <div className="ui-toolbar notes-sync-conflict-actions">
            <button type="button" className="ui-button ui-button--secondary" aria-expanded={review.detailId === row.id && Boolean(review.detail)} onClick={() => void review.compare(row)}>{t("Compare versions")}</button>
            <label>{t("Choose version")} <select className="ui-select" value={review.selected.get(row.id) ?? ""} onChange={event => review.choose(row, event.target.value)}>
              <option value="" disabled>{t("Choose an option")}</option>
              {row.allowedChoices.map(choice => <option key={choice} value={choice}>{t(conflictChoiceLabels[choice])}</option>)}
            </select></label>
          </div>
          {review.detailId === row.id && review.detail && <NotesSyncConflictVersions item={review.detail} />}
        </fieldset>)}
      </div>
      <div className="ui-toolbar notes-sync-conflict-actions">
        {review.pageIndex > 0 && <button type="button" className="ui-button ui-button--secondary" disabled={!review.canUse} onClick={review.previous}>{t("Previous page")}</button>}
        {review.page?.nextCursor !== null && review.page && <button type="button" className="ui-button ui-button--secondary" disabled={!review.canUse} onClick={() => void review.next()}>{t("Next page")}</button>}
        {review.failure && !review.failure.blocked && <button type="button" className="ui-button ui-button--secondary" disabled={!review.canUse} onClick={() => void review.retry()}>{t("Retry loading conflicts")}</button>}
        <button type="button" className="ui-button ui-button--primary" disabled={!review.canUse || !review.complete} onClick={review.review}>{t("Review choices")}</button>
      </div>
      {review.confirming && enabled && <div className="ui-panel" aria-label={t("Confirm local conflict choices")}>
        <p>{t("Save these conflict choices on this device?")}</p>
        <p>{t("Sync library ID")}: <span translate="no">{libraryId}</span></p>
        <ul>{(["local", "remote", "both"] as const).map(choice => <li key={choice}>{t(conflictChoiceLabels[choice])}: {selectedCounts[choice]}</li>)}</ul>
        <p>{t("All choices will be saved together locally. Nothing is uploaded until you start another manual sync.")}</p>
        <div className="ui-toolbar notes-sync-conflict-actions">
          <button type="button" className="ui-button ui-button--primary" disabled={!review.canUse || !review.complete} onClick={() => void review.apply()}>{t("Confirm and save locally")}</button>
          <button type="button" className="ui-button ui-button--secondary" disabled={review.busy} onClick={review.cancelConfirmation}>{t("Cancel")}</button>
        </div>
      </div>}
    </>}
    <button type="button" className="ui-button ui-button--secondary" onClick={onClose}>{t("Close conflict review")}</button>
  </section>;
}
