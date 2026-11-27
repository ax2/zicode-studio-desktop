import { useState } from "react";
import { t } from "../../shared/i18n";
import { formatDate, type NoteSource } from "./notesLogic";

function linkableSource(value: string): URL | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url : null;
}

export function NoteSourceDetails({
  source,
  openSource,
}: {
  source?: NoteSource;
  openSource?: (url: string) => Promise<void>;
}) {
  const [openingSource, setOpeningSource] = useState(false);
  const [copiedSource, setCopiedSource] = useState(false);
  const [copySourceError, setCopySourceError] = useState(false);
  const url = source?.url;
  if (!source || !url) return null;

  const sourceUrl = linkableSource(url);
  const attribution = [source.siteName, source.author].filter(Boolean).join(" · ");
  const copySource = () => {
    void navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopiedSource(true);
        setCopySourceError(false);
        window.setTimeout(() => setCopiedSource(false), 1600);
      })
      .catch(() => {
        setCopySourceError(true);
        window.setTimeout(() => setCopySourceError(false), 1600);
      });
  };

  return (
    <div className="notes-source">
      <p>
        {t("Source")}:{" "}
        {sourceUrl ? (
          <a
            href={sourceUrl.href}
            target="_blank"
            rel="noreferrer"
            title={openSource ? t("Open source in Studio Browser") : undefined}
            aria-busy={openingSource || undefined}
            onClick={openSource ? (event) => {
              event.preventDefault();
              if (openingSource) return;
              setOpeningSource(true);
              void openSource(sourceUrl.href).finally(() => setOpeningSource(false));
            } : undefined}
          >
            {url}
          </a>
        ) : url}
        <button
          type="button"
          className="notes-source-copy"
          aria-label={t("Copy source URL")}
          onClick={copySource}
        >
          {copiedSource ? t("Copied") : copySourceError ? t("Copy failed") : t("Copy")}
        </button>
      </p>
      {attribution ? <p className="notes-source-meta">{attribution}</p> : null}
      {source.publishedAt ? (
        <p className="notes-source-meta">{t("Published")}: {formatDate(source.publishedAt)}</p>
      ) : null}
      {source.capturedAt ? (
        <p className="notes-source-meta">{t("Captured")}: {formatDate(source.capturedAt)}</p>
      ) : null}
    </div>
  );
}
