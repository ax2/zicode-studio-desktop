import { useCallback, useState } from "react";
import { t } from "../../shared/i18n";
import { type CharacterFacet, characterFacets } from "./characterFacets";
import { NovelChapterDiscovery } from "./NovelChapterDiscovery";
import {
  type ManuscriptEvidence,
  ManuscriptSource,
  NovelChapterPicker,
} from "./NovelChapterPicker";
import { NovelDraftReview, needsReview, type ReviewCheck } from "./NovelDraftReview";
import { type CharacterRequest, type RecordPage, useCharacterRecords } from "./useCharacterRecords";

type Props = {
  characterId: string;
  characterName: string;
  disabled: boolean;
  request: CharacterRequest;
  onApproved: () => void;
};

type Draft = {
  id: string;
  facet: CharacterFacet;
  baseVersion: number | null;
  approvedVersion: number | null;
  evidence: ManuscriptEvidence;
  text: string;
};

export function NovelDraftPanel(props: Props) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <section className="ui-card" aria-label={t("Manuscript character drafts")}>
      <button
        type="button"
        className="ui-button"
        aria-expanded={open}
        onClick={() => {
          setLoaded(true);
          setOpen(!open);
        }}
      >
        {t("Manuscript character drafts")}
      </button>
      <div hidden={!open}>{loaded && <DraftHistory {...props} />}</div>
    </section>
  );
}

function DraftHistory({ characterId, characterName, request, disabled, onApproved }: Props) {
  const read = useCallback(
    async (before?: number) =>
      (await request({ kind: "list", characterId, before })) as RecordPage<Draft, number>,
    [request, characterId],
  );
  const records = useCharacterRecords(read);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reviews, setReviews] = useState(new Map<string, ReviewCheck>());
  const blocked = disabled || busy || records.loading;

  async function checkDrafts() {
    const drafts = records.page?.entries ?? [];
    setBusy(true);
    setError("");
    try {
      const checked = new Map<string, ReviewCheck>();
      for (let index = 0; index < drafts.length; index += 10) {
        const draftIds = drafts.slice(index, index + 10).map(({ id }) => id);
        const result = (await request({ kind: "review", characterId, draftIds })) as {
          entries: ReviewCheck[];
        };
        for (const entry of result.entries) checked.set(entry.id, entry);
      }
      setReviews(checked);
    } catch {
      setError(t("Could not check chapter revisions."));
    } finally {
      setBusy(false);
    }
  }

  async function approve(id: string) {
    setBusy(true);
    setError("");
    try {
      await request({ kind: "approve", id });
      setReviews(new Map());
      records.reload();
      onApproved();
    } catch (reason) {
      const code = String(reason);
      setError(
        t(
          code.includes("visual_assets_chapter_changed")
            ? "The chapter changed. Prepare a draft from the new revision."
            : code.includes("visual_assets_character_revision_changed")
              ? "The character version changed. Review it before preparing a new draft."
              : "Could not approve this draft.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <NovelChapterDiscovery
        characterId={characterId}
        characterName={characterName}
        request={request}
        disabled={disabled || busy}
        onSaved={records.reload}
      />
      <NovelChapterPicker
        characterId={characterId}
        characterName={characterName}
        request={request}
        disabled={disabled || busy}
        onSaved={records.reload}
      />
      {!!records.page?.entries.length && (
        <button
          type="button"
          className="ui-button"
          disabled={blocked}
          onClick={() => void checkDrafts()}
        >
          {t("Check loaded chapters for changes")}
        </button>
      )}
      {records.page?.entries.map((draft) => {
        const check = reviews.get(draft.id);
        const stale = needsReview(check);
        return (
          <details key={draft.id}>
            <summary>
              {draft.evidence.chapterTitle} · {t(characterFacets[draft.facet])} ·{" "}
              {draft.approvedVersion == null
                ? t("Pending approval")
                : `${t("Approved version")} ${draft.approvedVersion}`}
              {stale && ` · ${t("Review needed")}`}
            </summary>
            <ManuscriptSource evidence={draft.evidence} />
            <p>
              {t("Based on character version")} · {draft.baseVersion ?? t("None")}
            </p>
            <p className="visual-assets-backup-path">{draft.text}</p>
            <NovelDraftReview
              check={check}
              notebookId={draft.evidence.notebookId}
              facet={draft.facet}
              characterId={characterId}
              characterName={characterName}
              request={request}
              disabled={blocked}
              onSaved={records.reload}
            />
            {draft.approvedVersion == null && (
              <button
                type="button"
                className="ui-button ui-button--primary"
                disabled={blocked || stale}
                onClick={() => void approve(draft.id)}
              >
                {t("Approve as character version")}
              </button>
            )}
          </details>
        );
      })}
      {records.loading && <p role="status">{t("Loading…")}</p>}
      {records.error && (
        <button type="button" className="ui-button" onClick={records.reload}>
          {t("Reload character drafts")}
        </button>
      )}
      {records.page?.next != null && (
        <button
          type="button"
          className="ui-button"
          disabled={busy || records.loading}
          onClick={() => void records.more()}
        >
          {t("Load older drafts")}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
