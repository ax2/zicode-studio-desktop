import { useCallback, useState } from "react";
import { t } from "../../shared/i18n";
import { type ManuscriptEvidence, ManuscriptSource } from "./NovelChapterPicker";
import { characterFacets as facets, type CharacterFacet as Facet } from "./characterFacets";
import { type CharacterRequest, type RecordPage, useCharacterRecords } from "./useCharacterRecords";

interface Props {
  id: string;
  disabled: boolean;
  request: CharacterRequest;
  revisionChanged?: number;
}

export function CharacterRevisions(props: Props) {
  const [facet, setFacet] = useState<Facet>("identity");
  return (
    <section className="ui-card" aria-label={t("Character versions")}>
      <label>
        {t("Character versions")}
        <select
          className="ui-select"
          value={facet}
          onChange={(event) => setFacet(event.target.value as Facet)}
        >
          {(Object.entries(facets) as [Facet, string][]).map(([key, title]) => (
            <option key={key} value={key}>
              {t(title)}
            </option>
          ))}
        </select>
      </label>
      <RevisionEditor key={facet} facet={facet} {...props} />
    </section>
  );
}

type Version = { version: number; text: string; manuscript?: ManuscriptEvidence };

function RevisionEditor({
  id,
  disabled,
  request,
  facet,
  revisionChanged,
}: Props & { facet: Facet }) {
  const read = useCallback(
    async (before?: number) =>
      (await request({ kind: "revisions", id, facet, before })) as RecordPage<Version, number>,
    [request, id, facet],
  );
  const records = useCharacterRecords(read, revisionChanged);
  const [draft, setDraft] = useState<{ text: string; baseVersion: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const latest = records.page?.entries[0];
  const text = draft?.text ?? latest?.text ?? "";
  const staleDraft = !!draft && draft.baseVersion !== (latest?.version ?? null);
  const blocked = disabled || records.loading || !records.page || records.error || saving;

  async function save() {
    if (blocked || staleDraft || !draft || !text.trim() || text.trim() === latest?.text) return;
    setSaving(true);
    setError("");
    try {
      await request({ kind: "append", id, facet, previous: draft.baseVersion, text });
      setDraft(null);
      records.reload();
    } catch (reason) {
      const stale = String(reason).includes("visual_assets_character_revision_changed");
      setError(
        t(
          stale
            ? "The latest version changed. Review it before saving again."
            : "Could not save the character version.",
        ),
      );
      if (stale) records.reload();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          {t(facets[facet])}
          <textarea
            className="ui-textarea"
            required
            maxLength={4000}
            value={text}
            disabled={blocked}
            onChange={(event) =>
              setDraft({
                text: event.target.value,
                baseVersion: draft ? draft.baseVersion : (latest?.version ?? null),
              })
            }
          />
        </label>
        <button
          type="submit"
          className="ui-button"
          disabled={blocked || staleDraft || !text.trim() || text.trim() === latest?.text}
        >
          {t("Save new version")}
        </button>
      </form>
      {staleDraft && (
        <p role="status">{t("The latest version changed. Review it before saving again.")}</p>
      )}
      {staleDraft && (
        <button
          type="button"
          className="ui-button"
          onClick={() => {
            setDraft(null);
            setError("");
          }}
        >
          {t("Load latest version into editor")}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {records.page?.entries.map((entry) => (
        <details key={entry.version}>
          <summary>
            {t("Version")} {entry.version}
          </summary>
          <p className="visual-assets-backup-path">{entry.text}</p>
          {entry.manuscript && <ManuscriptSource evidence={entry.manuscript} />}
        </details>
      ))}
      {records.page?.next != null && (
        <button
          type="button"
          className="ui-button"
          disabled={records.loading || saving}
          onClick={() => void records.more()}
        >
          {t("Load older versions")}
        </button>
      )}
      {records.error && (
        <button type="button" className="ui-button" onClick={records.reload}>
          {t("Reload character versions")}
        </button>
      )}
    </>
  );
}
