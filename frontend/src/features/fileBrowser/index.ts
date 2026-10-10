import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { t } from "../../shared/i18n";
import { FileBrowserBridge, type FileBrowserStore } from "./FileBrowserApp";
import type { FileEntry } from "./fileBrowserLogic";

export interface FileBrowserGateway {
  listFiles(
    workspaceId: string,
    relativePath: string,
    offset?: number,
    snapshot?: string | null,
  ): Promise<{ entries?: FileEntry[]; nextOffset?: number | null; snapshot?: string }>;
}

export class NativeFileBrowser {
  private pathEl: HTMLElement;
  private gateway: FileBrowserGateway;
  private workspaceId: string;
  private onPathChange: ((path: string) => void) | null;
  private onOpenFile: ((path: string) => void) | null;
  private requestId = 0;
  private store: ReturnType<typeof createFileBrowserStore>;
  private root: Root;
  currentPath: string | null = null;

  constructor(
    container: HTMLElement,
    pathEl: HTMLElement,
    gateway: FileBrowserGateway,
    workspaceId: string,
    {
      onPathChange,
      onOpenFile,
    }: {
      onPathChange?: (path: string) => void;
      onOpenFile?: (path: string) => void;
    } = {},
  ) {
    this.pathEl = pathEl;
    this.gateway = gateway;
    this.workspaceId = workspaceId;
    this.onPathChange = onPathChange ?? null;
    this.onOpenFile = onOpenFile ?? null;
    this.store = createFileBrowserStore();
    this.root = createRoot(container);
    flushSync(() => {
      this.root.render(
        createElement(FileBrowserBridge, {
          store: this.store,
          onOpenDirectory: (path) => {
            this.setHighlight(null);
            this.load(path);
          },
          onSelectFile: (path) => {
            this.setHighlight(path);
          },
          onOpenFile: (path) => {
            this.onOpenFile?.(path);
          },
          onLoadMore: () => {
            void this.loadMore();
          },
        }),
      );
    });
  }

  private commit(patch: Partial<FileBrowserStore>): void {
    this.store.setState(patch);
    flushSync(() => {});
  }

  async load(relativePath = ""): Promise<void> {
    this.commit({
      status: "loading",
      entries: [],
      error: null,
      nextOffset: null,
      snapshot: null,
      loadingMore: false,
      moreError: null,
    });
    this.requestId += 1;
    const requestId = this.requestId;
    try {
      const response = await this.gateway.listFiles(this.workspaceId, relativePath);
      if (requestId !== this.requestId) return;
      if (
        !Array.isArray(response?.entries) ||
        (response.nextOffset != null &&
          (!Number.isSafeInteger(response.nextOffset) ||
            response.nextOffset !== response.entries.length ||
            !response.snapshot))
      ) {
        throw new Error("File page response is incomplete");
      }
      this.currentPath = relativePath;
      this.pathEl.textContent = relativePath || "/";
      this.pathEl.title = relativePath || "/";
      this.onPathChange?.(relativePath);
      this.commit({
        status: "ready",
        entries: response.entries,
        nextOffset: response.nextOffset ?? null,
        snapshot: response.snapshot ?? null,
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.commit({
        status: "error",
        error: error instanceof Error ? t(error.message) : t("Failed to load"),
      });
    }
  }

  async loadMore(): Promise<void> {
    const state = this.store.getState();
    if (
      state.status !== "ready" ||
      state.loadingMore ||
      state.nextOffset === null ||
      !state.snapshot ||
      this.currentPath === null
    )
      return;
    const requestId = ++this.requestId;
    this.commit({ loadingMore: true, moreError: null });
    try {
      const response = await this.gateway.listFiles(
        this.workspaceId,
        this.currentPath,
        state.nextOffset,
        state.snapshot,
      );
      if (requestId !== this.requestId) return;
      if (
        response.snapshot !== state.snapshot ||
        !Array.isArray(response.entries) ||
        (response.nextOffset != null &&
          (!Number.isSafeInteger(response.nextOffset) ||
            response.nextOffset <= state.nextOffset ||
            response.nextOffset !== state.nextOffset + response.entries.length))
      ) {
        throw new Error("File page response is incomplete");
      }
      this.commit({
        entries: [...this.store.getState().entries, ...response.entries],
        nextOffset: response.nextOffset ?? null,
        loadingMore: false,
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.commit({
        loadingMore: false,
        moreError: error instanceof Error ? t(error.message) : t("Failed to load"),
      });
    }
  }

  setHighlight(relativePath: string | null): void {
    this.commit({ highlightPath: relativePath });
  }

  getParentPath(): string | null {
    if (this.currentPath === null || this.currentPath === "") return null;
    const parts = this.currentPath.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
  }
}

function createFileBrowserStore() {
  return create<FileBrowserStore>()(() => ({
    status: "idle",
    entries: [],
    error: null,
    highlightPath: null,
    nextOffset: null,
    snapshot: null,
    loadingMore: false,
    moreError: null,
  }));
}
