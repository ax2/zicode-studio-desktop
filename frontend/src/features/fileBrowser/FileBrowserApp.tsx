import { fileIcon, formatSize, type FileEntry } from "./fileBrowserLogic";
import { t } from "../../shared/i18n";
import type { StoreApi, UseBoundStore } from "zustand";

export type FileBrowserStatus = "idle" | "loading" | "ready" | "error";

export interface FileBrowserStore {
  status: FileBrowserStatus;
  entries: FileEntry[];
  error: string | null;
  highlightPath: string | null;
}

export type FileBrowserStoreHook = UseBoundStore<StoreApi<FileBrowserStore>>;

function FileMessage({ text }: { text: string }) {
  return <div className="file-loading">{text}</div>;
}

export function FileBrowserApp({
  status,
  entries,
  error,
  highlightPath,
  onOpenDirectory,
}: {
  status: FileBrowserStatus;
  entries: FileEntry[];
  error: string | null;
  highlightPath: string | null;
  onOpenDirectory(path: string): void;
}) {
  if (status === "loading" || status === "idle") {
    return <FileMessage text={t("Loading…")} />;
  }
  if (status === "error") {
    return <FileMessage text={error || t("Failed to load")} />;
  }
  if (entries.length === 0) {
    return <FileMessage text={t("Empty directory")} />;
  }
  return (
    <>
      {entries.map((entry) => {
        const isDirectory = entry.kind === "directory";
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: file item click pattern preserved from the vanilla browser
          // biome-ignore lint/a11y/useKeyWithClickEvents: directory rows are mouse-driven in the vanilla file browser
          <div
            className={`file-item${isDirectory ? " directory" : ""}${
              highlightPath && entry.relativePath === highlightPath ? " is-highlighted" : ""
            }`}
            data-path={entry.relativePath}
            data-name={entry.name}
            data-is-directory={String(isDirectory)}
            key={entry.relativePath}
            onClick={isDirectory ? () => onOpenDirectory(entry.relativePath) : undefined}
          >
            <span className="file-icon" aria-hidden="true">
              {fileIcon(entry)}
            </span>
            <span className="file-name" title={entry.name}>
              {entry.name}
            </span>
            {!isDirectory && entry.size != null ? (
              <span className="file-size">{formatSize(entry.size)}</span>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function FileBrowserBridge({
  store,
  onOpenDirectory,
}: {
  store: FileBrowserStoreHook;
  onOpenDirectory(path: string): void;
}) {
  const status = store((state) => state.status);
  const entries = store((state) => state.entries);
  const error = store((state) => state.error);
  const highlightPath = store((state) => state.highlightPath);
  return (
    <FileBrowserApp
      status={status}
      entries={entries}
      error={error}
      highlightPath={highlightPath}
      onOpenDirectory={onOpenDirectory}
    />
  );
}
