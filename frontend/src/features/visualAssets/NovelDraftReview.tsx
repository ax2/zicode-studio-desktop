import { useState } from "react";
import { t } from "../../shared/i18n";
import type { CharacterFacet } from "./characterFacets";
import { type Chapter, NovelChapterPicker } from "./NovelChapterPicker";
import type { CharacterRequest } from "./useCharacterRecords";

export type ReviewCheck = {
  id: string;
  latest: Chapter | null;
  chapterChanged: boolean;
  baseChanged: boolean;
};

export function needsReview(check?: ReviewCheck) {
  return Boolean(check && (!check.latest || check.chapterChanged || check.baseChanged));
}

export function NovelDraftReview({
  check,
  notebookId,
  facet,
  characterId,
  characterName,
  request,
  disabled,
  onSaved,
}: {
  check?: ReviewCheck;
  notebookId: string;
  facet: CharacterFacet;
  characterId: string;
  characterName: string;
  request: CharacterRequest;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [chapter, setChapter] = useState<Chapter>();
  return (
    <>
      {check && (
        <p>
          {t(
            !check.latest
              ? "The cited chapter is unavailable."
              : check.chapterChanged
                ? "The cited chapter has a newer revision."
                : "The cited chapter is current.",
          )}
        </p>
      )}
      {check?.baseChanged && <p>{t("The draft uses an older character version.")}</p>}
      {!chapter && needsReview(check) && check?.latest && (
        <button
          type="button"
          className="ui-button"
          disabled={disabled}
          onClick={() => setChapter(check.latest ?? undefined)}
        >
          {t("Prepare draft from current chapter")}
        </button>
      )}
      {chapter && (
        <>
          <button
            type="button"
            className="ui-button"
            disabled={disabled}
            onClick={() => setChapter(undefined)}
          >
            {t("Close current chapter editor")}
          </button>
          <NovelChapterPicker
            initial={{ notebookId, chapter, facet }}
            characterId={characterId}
            characterName={characterName}
            request={request}
            disabled={disabled}
            onSaved={() => {
              setChapter(undefined);
              onSaved();
            }}
          />
        </>
      )}
    </>
  );
}
