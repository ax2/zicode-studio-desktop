import { create } from "zustand";
import { t } from "../../shared/i18n";
import { friendlyPluginError, localizeHostError } from "../../shared/hostErrors";
import type { DocumentImportResult } from "./documentsLogic";

export interface DocumentImportInput {
  sceneId: string;
  workspaceId: string;
  document: string;
  fileName?: string;
  title?: string;
  kind?: string;
}

export interface DocumentsGateway {
  import(input: DocumentImportInput): Promise<DocumentImportResult>;
}

export class DocumentsHttpGateway implements DocumentsGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Documents gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
  }

  async #post(path: string, body: unknown): Promise<DocumentImportResult> {
    const response = await this.#fetch(new URL(path, this.#location.origin).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = await response.json();
        detail = parsed?.error?.message || parsed?.error?.code || "";
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new Error(detail || `document import failed (${response.status})`);
    }
    return (await response.json()) as DocumentImportResult;
  }

  import(input: DocumentImportInput): Promise<DocumentImportResult> {
    return this.#post("/v2/documents/import", input);
  }
}

export type PreviewMode = "rendered" | "source";

export interface NotebookRef {
  id: string;
  title: string;
}

export interface DocumentsState {
  fileName: string;
  document: string;
  preview: PreviewMode;
  busy: boolean;
  saving: boolean;
  error: string;
  result: DocumentImportResult | null;
  notebooks: NotebookRef[];
  selectedNotebookId: string;
  setFile(name: string, document: string): void;
  importFile(name: string, document: string): Promise<void>;
  clear(): void;
  setPreview(mode: PreviewMode): void;
  loadNotebooks(): Promise<void>;
  setNotebook(id: string): void;
  run(): Promise<void>;
  save(): Promise<void>;
  copyMarkdown(): Promise<void>;
  download(): void;
}

export interface DocumentsOptions {
  gateway?: DocumentsGateway;
  getTarget(): { sceneId: string; workspaceId: string };
  notify(message: string): void;
  listNotebooks?(): Promise<NotebookRef[]>;
  saveToNotes?(notebookId: string, fileName: string, markdown: string): Promise<void>;
}

export function createDocumentsStore(options: DocumentsOptions) {
  const {
    gateway = new DocumentsHttpGateway(),
    getTarget,
    notify,
    listNotebooks,
    saveToNotes,
  } = options;
  return create<DocumentsState>()((set, get) => ({
    fileName: "",
    document: "",
    preview: "rendered",
    busy: false,
    saving: false,
    error: "",
    result: null,
    notebooks: [],
    selectedNotebookId: "",

    setFile(name, document) {
      set({ fileName: name, document, result: null, error: "" });
    },

    async importFile(name, document) {
      set({ fileName: name, document, result: null, error: "" });
      await get().run();
    },

    clear() {
      set({ fileName: "", document: "", result: null, error: "" });
    },

    setPreview(mode) {
      set({ preview: mode });
    },

    async loadNotebooks() {
      if (!listNotebooks) return;
      try {
        const notebooks = await listNotebooks();
        set((state) => ({
          notebooks,
          selectedNotebookId: state.selectedNotebookId || notebooks[0]?.id || "",
        }));
      } catch (error) {
        set({ error: friendlyPluginError(error) });
      }
    },

    setNotebook(id) {
      set({ selectedNotebookId: id });
    },

    async run() {
      const { document, fileName, busy } = get();
      if (!document || busy) return;
      const target = getTarget();
      set({ busy: true, error: "", result: null });
      try {
        const result = await gateway.import({
          sceneId: target.sceneId,
          workspaceId: target.workspaceId,
          document,
          ...(fileName ? { fileName } : {}),
        });
        set({ result, busy: false });
        notify(t("Document imported"));
        await get().loadNotebooks();
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async save() {
      const { result, saving, selectedNotebookId } = get();
      if (!result || saving || !saveToNotes) return;
      set({ saving: true, error: "" });
      try {
        await saveToNotes(selectedNotebookId, result.fileName, result.markdown);
        set({ saving: false });
        // Saving may auto-create the fallback notebook when none existed, so
        // refresh the target list to reflect it.
        await get().loadNotebooks();
        notify(t("Saved to notes"));
      } catch (error) {
        set({ saving: false, error: localizeHostError(error).message });
      }
    },

    async copyMarkdown() {
      const { result } = get();
      if (!result) return;
      try {
        if (typeof navigator.clipboard?.writeText !== "function") {
          throw new Error(t("Clipboard access is not available"));
        }
        await navigator.clipboard.writeText(result.markdown);
        notify(t("Copied"));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },

    download() {
      const { result } = get();
      if (!result?.markdown.trim()) return;
      const baseName = (result.fileName || result.title || "document").replace(
        /\.[^.]+$/,
        "",
      );
      const blob = new Blob([result.markdown], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${baseName}.md`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  }));
}

export type DocumentsStore = ReturnType<typeof createDocumentsStore>;
