import { useState } from "react";
import { t } from "../../shared/i18n";
import { type CharacterFacet, characterFacets } from "./characterFacets";
import type { CharacterRequest } from "./useCharacterRecords";

export type ManuscriptEvidence = {
  workspaceId: string;
  notebookId: string;
  chapterId: string;
  chapterTitle: string;
  revision: string;
  line: number;
  quote: string;
};

type Note = { id: string; title: string };
export type Chapter = Note & { revision: string };

export function NovelChapterPicker({
  characterId,
  characterName,
  request,
  disabled,
  onSaved,
  initial,
  onBusyChange,
}: {
  characterId: string;
  characterName: string;
  request: CharacterRequest;
  disabled: boolean;
  onSaved: () => void;
  initial?: { notebookId: string; chapter: Chapter; facet: CharacterFacet };
  onBusyChange?: (busy: boolean) => void;
}) {
  const [notebooks, setNotebooks] = useState<Note[] | null>(null);
  const [notebook, setNotebook] = useState(initial?.notebookId ?? "");
  const [chapters, setChapters] = useState<Chapter[] | null>(initial ? [initial.chapter] : null);
  const [chapterId, setChapterId] = useState(initial?.chapter.id ?? "");
  const [title, setTitle] = useState("");
  const [more, setMore] = useState(false);
  const [phrase, setPhrase] = useState(characterName);
  const [facet, setFacet] = useState<CharacterFacet>(initial?.facet ?? "identity");
  const [preview, setPreview] = useState<{
    baseVersion: number | null;
    excerpts: ManuscriptEvidence[];
  }>();
  const [evidence, setEvidence] = useState<ManuscriptEvidence>();
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = disabled || busy;
  const chapter = chapters?.find((entry) => entry.id === chapterId);

  function clearPreview() {
    setPreview(undefined);
    setEvidence(undefined);
    setText("");
    setDraftId("");
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      const code = String(reason);
      setError(
        t(
          code.includes("visual_assets_chapter_changed")
            ? "The chapter changed. Reload it and review its evidence again."
            : code.includes("visual_assets_character_revision_changed")
              ? "The latest version changed. Review it before saving again."
              : "Could not prepare the chapter draft.",
        ),
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="ui-card">
      {initial ? (
        <p>{initial.chapter.title}</p>
      ) : (
        <button
          type="button"
          className="ui-button"
          disabled={blocked}
          onClick={() =>
            void run(async () => {
              const result = (await request({ kind: "notebooks" })) as { notebooks: Note[] };
              setNotebooks(result.notebooks);
              setNotebook(result.notebooks[0]?.id ?? "");
              setChapters(null);
              setChapterId("");
              setMore(false);
              clearPreview();
            })
          }
        >
          {t("Choose chapter from Notes")}
        </button>
      )}
      {notebooks?.length === 0 && <p role="status">{t("No Notes notebooks in this workspace.")}</p>}
      {notebooks && notebooks.length > 0 && (
        <form
          className="ui-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              clearPreview();
              const result = (await request({ kind: "chapters", notebookId: notebook, title })) as {
                chapters: Chapter[];
                more: boolean;
              };
              setChapters(result.chapters);
              setChapterId(result.chapters[0]?.id ?? "");
              setMore(result.more);
            });
          }}
        >
          <label>
            {t("Notebook")}{" "}
            <select
              className="ui-select"
              value={notebook}
              disabled={blocked}
              onChange={(event) => {
                setNotebook(event.target.value);
                setChapters(null);
                setChapterId("");
                setMore(false);
                clearPreview();
              }}
            >
              {notebooks.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
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
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <button type="submit" className="ui-button" disabled={blocked}>
            {t("Load chapters")}
          </button>
        </form>
      )}
      {more && <p role="status">{t("Filter by chapter title to see more matches.")}</p>}
      {chapters?.length === 0 && <p role="status">{t("No chapters match this title filter.")}</p>}
      {chapters && chapters.length > 0 && (
        <form
          className="ui-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            if (!chapter) return;
            void run(async () => {
              clearPreview();
              const result = (await request({
                kind: "preview",
                characterId,
                facet,
                notebookId: notebook,
                chapterId: chapter.id,
                revision: chapter.revision,
                phrase,
              })) as NonNullable<typeof preview>;
              setPreview(result);
            });
          }}
        >
          {!initial && (
            <label>
              {t("Chapter")}{" "}
              <select
                className="ui-select"
                value={chapterId}
                disabled={blocked}
                onChange={(event) => {
                  setChapterId(event.target.value);
                  clearPreview();
                }}
              >
                {chapters.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t("Character facet")}{" "}
            <select
              className="ui-select"
              value={facet}
              disabled={blocked}
              onChange={(event) => {
                setFacet(event.target.value as CharacterFacet);
                clearPreview();
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
            {t("Phrase in chapter")}{" "}
            <input
              className="ui-input"
              value={phrase}
              maxLength={80}
              disabled={blocked}
              onChange={(event) => {
                setPhrase(event.target.value);
                clearPreview();
              }}
            />
          </label>
          <button type="submit" className="ui-button" disabled={blocked || !phrase.trim()}>
            {t("Find chapter excerpts")}
          </button>
        </form>
      )}
      {preview?.excerpts.length === 0 && <p role="status">{t("No matching chapter excerpts.")}</p>}
      {preview?.excerpts.map((excerpt) => (
        <div key={excerpt.line} className="visual-assets-backup-path">
          <p>
            {t("Line")} {excerpt.line} · {excerpt.quote}
          </p>
          <button
            type="button"
            className="ui-button"
            disabled={blocked}
            onClick={() => {
              setEvidence(excerpt);
              setText(excerpt.quote);
              setDraftId(crypto.randomUUID());
            }}
          >
            {t("Use this excerpt")}
          </button>
        </div>
      ))}
      {evidence && preview && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await request({
                kind: "save",
                proposal: {
                  draftId,
                  characterId,
                  facet,
                  baseVersion: preview.baseVersion,
                  evidence,
                  text,
                },
              });
              clearPreview();
              onSaved();
            });
          }}
        >
          <ManuscriptSource evidence={evidence} />
          <p>
            {t("Based on character version")} · {preview.baseVersion ?? t("None")}
          </p>
          <label>
            {t("Proposed character text")}{" "}
            <textarea
              className="ui-textarea"
              value={text}
              maxLength={4000}
              disabled={blocked}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <button type="submit" className="ui-button" disabled={blocked || !text.trim()}>
            {t("Save character draft")}
          </button>
        </form>
      )}
      {busy && <p role="status">{t("Loading…")}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

export function ManuscriptSource({ evidence }: { evidence: ManuscriptEvidence }) {
  return (
    <div className="visual-assets-backup-path">
      <p>
        {evidence.chapterTitle} · {t("Line")} {evidence.line}
      </p>
      <code>{evidence.revision}</code>
      <blockquote>{evidence.quote}</blockquote>
    </div>
  );
}
