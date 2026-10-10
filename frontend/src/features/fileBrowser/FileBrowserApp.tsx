import type { StoreApi, UseBoundStore } from "zustand";
import { t } from "../../shared/i18n";
import { type FileEntry, fileIcon, formatSize } from "./fileBrowserLogic";

export type FileBrowserStatus = "idle" | "loading" | "ready" | "error";

export interface FileBrowserStore {
  status: FileBrowserStatus;
  entries: FileEntry[];
  error: string | null;
  highlightPath: string | null;
  nextOffset: number | null;
  snapshot: string | null;
  loadingMore: boolean;
  moreError: string | null;
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
  nextOffset,
  loadingMore,
  moreError,
  onOpenDirectory,
  onSelectFile,
  onOpenFile,
  onLoadMore,
}: {
  status: FileBrowserStatus;
  entries: FileEntry[];
  error: string | null;
  highlightPath: string | null;
  nextOffset: number | null;
  loadingMore: boolean;
  moreError: string | null;
  onOpenDirectory(path: string): void;
  onSelectFile?(path: string): void;
  onOpenFile?(path: string): void;
  onLoadMore(): void;
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
        const itemClass = `file-item${isDirectory ? " directory" : ""}${
          highlightPath && entry.relativePath === highlightPath ? " is-highlighted" : ""
        }`;
        const commonProps = {
          className: itemClass,
          "data-path": entry.relativePath,
          "data-name": entry.name,
          "data-is-directory": String(isDirectory),
        };
        const children = (
          <>
            <span className="file-icon" aria-hidden="true">
              {fileIcon(entry)}
            </span>
            <span className="file-name" title={entry.name}>
              {entry.name}
            </span>
            {!isDirectory && entry.size != null ? (
              <span className="file-size">{formatSize(entry.size)}</span>
            ) : null}
          </>
        );
        return (
          <button
            key={entry.relativePath}
            type="button"
            {...commonProps}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("application/x-zicode-file", entry.relativePath);
              event.dataTransfer.setData("text/plain", entry.relativePath);
              event.dataTransfer.effectAllowed = "copy";
            }}
            title={isDirectory ? t("Open directory") : t("Double-click to open")}
            onClick={() => {
              if (isDirectory) onOpenDirectory(entry.relativePath);
              else onSelectFile?.(entry.relativePath);
            }}
            onDoubleClick={() => {
              if (!isDirectory) onOpenFile?.(entry.relativePath);
            }}
          >
            {children}
          </button>
        );
      })}
      {nextOffset !== null ? (
        <div className="file-loading">
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? t("Loading more files…") : t("Load more files")}
          </button>
          {moreError ? <p role="alert">{moreError}</p> : null}
        </div>
      ) : null}
    </>
  );
}

export function FileBrowserBridge({
  store,
  onOpenDirectory,
  onSelectFile,
  onOpenFile,
  onLoadMore,
}: {
  store: FileBrowserStoreHook;
  onOpenDirectory(path: string): void;
  onSelectFile?(path: string): void;
  onOpenFile?(path: string): void;
  onLoadMore(): void;
}) {
  const status = store((state) => state.status);
  const entries = store((state) => state.entries);
  const error = store((state) => state.error);
  const highlightPath = store((state) => state.highlightPath);
  const nextOffset = store((state) => state.nextOffset);
  const loadingMore = store((state) => state.loadingMore);
  const moreError = store((state) => state.moreError);
  return (
    <FileBrowserApp
      status={status}
      entries={entries}
      error={error}
      highlightPath={highlightPath}
      nextOffset={nextOffset}
      loadingMore={loadingMore}
      moreError={moreError}
      onOpenDirectory={onOpenDirectory}
      onSelectFile={onSelectFile}
      onOpenFile={onOpenFile}
      onLoadMore={onLoadMore}
    />
  );
}
