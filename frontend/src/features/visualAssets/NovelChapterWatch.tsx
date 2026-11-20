import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { CharacterFacet } from "./characterFacets";
import type { Chapter } from "./NovelChapterPicker";
import type { CharacterRequest } from "./useCharacterRecords";

type Watch = {
  id: string;
  state: "running" | "paused" | "interrupted" | "error";
  completedPasses: number;
  checkedAt: string | null;
  pending: number;
};
type Page = { entries: (Chapter & { status: string })[]; next: string | null };
const labels = {
  running: "Watching this notebook",
  paused: "Chapter watching paused",
  interrupted: "Resume chapter watching after restarting Studio",
  error: "Chapter watching stopped. Check Notes access and the source files before resuming.",
};

export function NovelChapterWatch({
  characterId,
  notebookId,
  facet,
  request,
  disabled,
  editing,
  onChoose,
}: {
  characterId: string;
  notebookId: string;
  facet: CharacterFacet;
  request: CharacterRequest;
  disabled: boolean;
  editing: boolean;
  onChoose: (chapter: Chapter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [watch, setWatch] = useState<Watch | null>();
  const [page, setPage] = useState<Page>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const sequence = useRef(0);
  const working = useRef(false);
  const send = useCallback(
    (kind: string, after?: string) =>
      request({
        kind: "watch",
        action: { kind, scope: { characterId, notebookId, facet }, ...(after ? { after } : {}) },
      }),
    [request, characterId, notebookId, facet],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!working.current) {
        const current = ++sequence.current;
        try {
          const result = (await send("status")) as { watch: Watch | null };
          if (active && current === sequence.current) {
            setWatch(result.watch);
            setStatusError("");
          }
        } catch {
          if (active && current === sequence.current)
            setStatusError(t("Could not read chapter watching status."));
        }
      }
      if (active) timer = setTimeout(() => void poll(), 5000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, send]);

  async function run(kind: "start" | "pause" | "entries", after?: string) {
    working.current = true;
    ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await send(kind, after);
      if (kind === "entries") setPage(result as Page);
      else setWatch((result as { watch: Watch }).watch);
    } catch (reason) {
      setError(
        t(
          String(reason).includes("visual_assets_watch_limit")
            ? "Pause another chapter watch before starting this one."
            : "Could not update chapter watching. Check Notes access and retry.",
        ),
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="ui-card" aria-label={t("Automatic chapter checks")}>
      <button
        type="button"
        className="ui-button"
        disabled={disabled || busy}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {t("Automatic chapter checks")}
      </button>
      {open && (
        <>
          <p>
            {t(
              "Studio checks this notebook in batches even when this view is closed. Closing the workspace window pauses checking; saved progress can be resumed after restart. No model calls or character changes are made.",
            )}
          </p>
          {watch === undefined && !error && !statusError && <p role="status">{t("Loading…")}</p>}
          {watch !== undefined && (
            <button
              type="button"
              className="ui-button"
              disabled={disabled || busy}
              onClick={() => void run(watch?.state === "running" ? "pause" : "start")}
            >
              {t(
                watch?.state === "running"
                  ? "Pause chapter watching"
                  : watch
                    ? "Resume chapter watching"
                    : "Start chapter watching",
              )}
            </button>
          )}
          {watch && (
            <>
              <p role="status">{t(labels[watch.state])}</p>
              <p>
                {t("Completed notebook checks")} · {watch.completedPasses} ·{" "}
                {t("Chapters awaiting a draft")} · {watch.pending}
              </p>
              {watch.checkedAt && (
                <p>
                  {t("Last complete notebook check")} ·{" "}
                  <time dateTime={watch.checkedAt}>
                    {new Date(watch.checkedAt).toLocaleString()}
                  </time>
                </p>
              )}
              <button
                type="button"
                className="ui-button"
                disabled={disabled || busy || editing}
                onClick={() => void run("entries")}
              >
                {t("Show watched chapters")}
              </button>
            </>
          )}
          {page && (
            <p>
              {t("These are saved check results. Opening a chapter verifies its revision again.")}
            </p>
          )}
          {page?.entries.length === 0 && (
            <p role="status">{t("No matching chapters on this page.")}</p>
          )}
          {page?.entries.map((entry) => (
            <div key={entry.id} className="visual-assets-backup-path">
              <p>
                {entry.title} ·{" "}
                {t(
                  entry.status === "new"
                    ? "No draft for this chapter and facet"
                    : entry.status === "baseChanged"
                      ? "The draft uses an older character version."
                      : "The cited chapter has a newer revision.",
                )}
              </p>
              <button
                type="button"
                className="ui-button"
                disabled={disabled || busy || editing}
                onClick={() => onChoose(entry)}
              >
                {t("Prepare draft from watched chapter")}
              </button>
            </div>
          ))}
          {page?.next && (
            <button
              type="button"
              className="ui-button"
              disabled={disabled || busy || editing}
              onClick={() => void run("entries", page.next ?? undefined)}
            >
              {t("More watched chapters")}
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {statusError && <p role="alert">{statusError}</p>}
        </>
      )}
    </section>
  );
}
