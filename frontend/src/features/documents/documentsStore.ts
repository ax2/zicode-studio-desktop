import { create } from "zustand";
import { t } from "../../shared/i18n";
import type { DocumentImportResult } from "./documentsLogic";

export interface DocumentImportInput {
  sceneId: string;
  workspaceId: string;
  document: string;
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

export interface DocumentsState {
  fileName: string;
  document: string;
  preview: PreviewMode;
  busy: boolean;
  saving: boolean;
  error: string;
  result: DocumentImportResult | null;
  setFile(name: string, document: string): void;
  clear(): void;
  setPreview(mode: PreviewMode): void;
  run(): Promise<void>;
  save(): Promise<void>;
  copyMarkdown(): Promise<void>;
}

export interface DocumentsOptions {
  gateway?: DocumentsGateway;
  getTarget(): { sceneId: string; workspaceId: string };
  notify(message: string): void;
  saveToNotes?(fileName: string, markdown: string): Promise<void>;
}

export function createDocumentsStore(options: DocumentsOptions) {
  const {
    gateway = new DocumentsHttpGateway(),
    getTarget,
    notify,
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

    setFile(name, document) {
      set({ fileName: name, document, result: null, error: "" });
    },

    clear() {
      set({ fileName: "", document: "", result: null, error: "" });
    },

    setPreview(mode) {
      set({ preview: mode });
    },

    async run() {
      const { document, busy } = get();
      if (!document || busy) return;
      const target = getTarget();
      set({ busy: true, error: "", result: null });
      try {
        const result = await gateway.import({
          sceneId: target.sceneId,
          workspaceId: target.workspaceId,
          document,
        });
        set({ result, busy: false });
        notify(t("Document imported"));
      } catch (error) {
        set({ busy: false, error: error instanceof Error ? error.message : String(error) });
      }
    },

    async save() {
      const { result, saving } = get();
      if (!result || saving || !saveToNotes) return;
      set({ saving: true, error: "" });
      try {
        await saveToNotes(result.fileName, result.markdown);
        set({ saving: false });
        notify(t("Saved to notes"));
      } catch (error) {
        set({ saving: false, error: error instanceof Error ? error.message : String(error) });
      }
    },

    async copyMarkdown() {
      const { result } = get();
      if (!result) return;
      try {
        await navigator.clipboard?.writeText(result.markdown);
        notify(t("Copied"));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  }));
}

export type DocumentsStore = ReturnType<typeof createDocumentsStore>;
