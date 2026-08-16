import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { create } from "zustand";
import { FileBrowserBridge, type FileBrowserStore } from "./FileBrowserApp";
import type { FileEntry } from "./fileBrowserLogic";
import { t } from "../../shared/i18n";

export interface FileBrowserGateway {
  listFiles(
    workspaceId: string,
    relativePath: string,
  ): Promise<{ entries?: FileEntry[] }>;
}

export class NativeFileBrowser {
  private pathEl: HTMLElement;
  private gateway: FileBrowserGateway;
  private workspaceId: string;
  private onPathChange: ((path: string) => void) | null;
  private requestId = 0;
  private store: ReturnType<typeof createFileBrowserStore>;
  private root: Root;
  currentPath: string | null = null;

  constructor(
    container: HTMLElement,
    pathEl: HTMLElement,
    gateway: FileBrowserGateway,
    workspaceId: string,
    { onPathChange }: { onPathChange?: (path: string) => void } = {},
  ) {
    this.pathEl = pathEl;
    this.gateway = gateway;
    this.workspaceId = workspaceId;
    this.onPathChange = onPathChange ?? null;
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
        }),
      );
    });
  }

  private commit(patch: Partial<FileBrowserStore>): void {
    this.store.setState(patch);
    flushSync(() => {});
  }

  async load(relativePath = ""): Promise<void> {
    this.commit({ status: "loading", entries: [], error: null });
    this.requestId += 1;
    const requestId = this.requestId;
    try {
      const response = await this.gateway.listFiles(this.workspaceId, relativePath);
      if (requestId !== this.requestId) return;
      this.currentPath = relativePath;
      this.pathEl.textContent = relativePath || "/";
      this.pathEl.title = relativePath || "/";
      this.onPathChange?.(relativePath);
      this.commit({ status: "ready", entries: response.entries ?? [] });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.commit({
        status: "error",
        error: error instanceof Error ? error.message : t("Failed to load"),
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
  }));
}
