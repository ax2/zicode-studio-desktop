import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { NoteSummary } from "./notesLogic";

export function NoteReferenceButton({
  note,
  title,
  role,
  onError,
}: {
  note: NoteSummary;
  title: string;
  role?: string;
  onError(error: Error): void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <button
      type="button"
      role={role}
      className="ui-button ui-button--ghost"
      disabled={busy}
      aria-busy={busy}
      title={t("Copy note link")}
      onClick={async () => {
        setBusy(true);
        try {
          if (typeof navigator.clipboard?.writeText !== "function")
            throw new Error(t("Clipboard access is not available"));
          const label = (title.trim() || note.title).replace(/[\\[\]\r\n]/g, (character) =>
            /[\r\n]/.test(character) ? " " : `\\${character}`,
          );
          await navigator.clipboard.writeText(
            `[${label}](zicode-note://${note.notebookId}/${note.id})`,
          );
          if (active.current) setCopied(true);
        } catch (error) {
          if (active.current) onError(error instanceof Error ? error : new Error(String(error)));
        } finally {
          if (active.current) setBusy(false);
        }
      }}
    >
      {copied ? t("Copied") : t("Copy note link")}
    </button>
  );
}
