import { useState } from "react";
import { t } from "../../shared/i18n";
import { type CharacterFacet, characterFacets } from "./characterFacets";
import { type Chapter, NovelChapterPicker } from "./NovelChapterPicker";
import { NovelChapterWatch } from "./NovelChapterWatch";
import type { CharacterRequest } from "./useCharacterRecords";

const statuses = {
  new: "No draft for this chapter and facet",
  chapterChanged: "The cited chapter has a newer revision.",
  baseChanged: "The draft uses an older character version.",
  recorded: "Current chapter already has a draft",
};
type Entry = Chapter & { status: keyof typeof statuses; draftId: string | null };
type Page = { entries: Entry[]; next: string | null };

export function NovelChapterDiscovery({
  characterId,
  characterName,
  request,
  disabled,
  onSaved,
}: {
  characterId: string;
  characterName: string;
  request: CharacterRequest;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [books, setBooks] = useState<{ id: string; title: string }[]>();
  const [notebookId, setNotebook] = useState("");
  const [facet, setFacet] = useState<CharacterFacet>("identity");
  const [title, setTitle] = useState("");
  const [needsWorkOnly, setNeedsWorkOnly] = useState(true);
  const [page, setPage] = useState<Page>();
  const [chapter, setChapter] = useState<Chapter>();
  const [editorBusy, setEditorBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = disabled || busy || !!chapter;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(t("Could not discover chapter updates. Retry this page."));
    } finally {
      setBusy(false);
    }
  }

  async function discover(after?: string) {
    const result = (await request({
      kind: "discover",
      query: { characterId, notebookId, facet, title, needsWorkOnly, after },
    })) as Page;
    setPage(result);
  }

  return (
    <section className="ui-card" aria-label={t("Discover chapter updates")}>
      <button
        type="button"
        className="ui-button"
        disabled={blocked}
        onClick={() =>
          void run(async () => {
            const result = (await request({ kind: "notebooks" })) as {
              notebooks: { id: string; title: string }[];
            };
            setBooks(result.notebooks);
            setNotebook(result.notebooks[0]?.id ?? "");
            setPage(undefined);
          })
        }
      >
        {t("Discover chapter updates")}
      </button>
      {books?.length === 0 && <p role="status">{t("No Notes notebooks in this workspace.")}</p>}
      {!!books?.length && (
        <form
          className="ui-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => discover());
          }}
        >
          <label>
            {t("Notebook")}{" "}
            <select
              className="ui-select"
              value={notebookId}
              disabled={blocked}
              onChange={(event) => {
                setNotebook(event.target.value);
                setPage(undefined);
              }}
            >
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Character facet")}{" "}
            <select
              className="ui-select"
              value={facet}
              disabled={blocked}
              onChange={(event) => {
                setFacet(event.target.value as CharacterFacet);
                setPage(undefined);
              }}
            >
              {Object.entries(characterFacets).map(([key, label]) => (
                <option key={key} value={key}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Chapter title filter")}{" "}
            <input
              className="ui-input"
              value={title}
              maxLength={120}
              disabled={blocked}
              onChange={(event) => {
                setTitle(event.target.value);
                setPage(undefined);
              }}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={needsWorkOnly}
              disabled={blocked}
              onChange={(event) => {
                setNeedsWorkOnly(event.target.checked);
                setPage(undefined);
              }}
            />
            {t("Only chapters needing a new draft")}
          </label>
          <button type="submit" className="ui-button" disabled={blocked}>
            {t("Refresh chapter discovery")}
          </button>
        </form>
      )}
      {!!books?.length && (
        <NovelChapterWatch
          key={`${notebookId}:${facet}`}
          characterId={characterId}
          notebookId={notebookId}
          facet={facet}
          request={request}
          disabled={disabled || busy}
          editing={!!chapter}
          onChoose={setChapter}
        />
      )}
      {page && (
        <p>
          {t(
            "Checks this notebook against saved drafts for the selected character facet. New drafts still need approval.",
          )}
        </p>
      )}
      {page?.entries.length === 0 && <p role="status">{t("No matching chapters on this page.")}</p>}
      {page?.entries.map((entry) => (
        <div key={entry.id} className="visual-assets-backup-path">
          <p>
            {entry.title} · {t(statuses[entry.status])}
          </p>
          <button
            type="button"
            className="ui-button"
            disabled={blocked}
            onClick={() => setChapter(entry)}
          >
            {t("Prepare draft from current chapter")}
          </button>
        </div>
      ))}
      {page?.next && (
        <button
          type="button"
          className="ui-button"
          disabled={blocked}
          onClick={() => void run(() => discover(page.next ?? undefined))}
        >
          {t("Continue checking chapters")}
        </button>
      )}
      {page && !page.next && (
        <p role="status">
          {t("Reached the end of this notebook. Refresh to check subsequent changes.")}
        </p>
      )}
      {chapter && (
        <>
          <button
            type="button"
            className="ui-button"
            disabled={disabled || editorBusy}
            onClick={() => {
              if (window.confirm(t("Close this chapter editor and discard any unsaved draft?")))
                setChapter(undefined);
            }}
          >
            {t("Close current chapter editor")}
          </button>
          <NovelChapterPicker
            initial={{ notebookId, chapter, facet }}
            characterId={characterId}
            characterName={characterName}
            request={request}
            onBusyChange={setEditorBusy}
            disabled={disabled}
            onSaved={() => {
              setChapter(undefined);
              setPage(undefined);
              onSaved();
            }}
          />
        </>
      )}
      {busy && <p role="status">{t("Loading…")}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
