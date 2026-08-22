import { create } from "zustand";
import { t } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";
import type { OcrResult } from "./ocrLogic";

export interface OcrScope {
  sceneId: string;
  workspaceId: string;
}

export interface OcrGateway {
  extract(scope: OcrScope, image: string, language?: string): Promise<OcrResult>;
}

export class OcrHttpGateway implements OcrGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("OCR gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
  }

  async extract(scope: OcrScope, image: string, language?: string): Promise<OcrResult> {
    const response = await this.#fetch(
      new URL("/v2/ocr/extract", this.#location.origin).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, image, language }),
      },
    );
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = await response.json();
        detail = parsed?.error?.message || parsed?.error?.code || "";
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new Error(detail || `OCR failed (${response.status})`);
    }
    return (await response.json()) as OcrResult;
  }
}

export interface OcrState {
  image: string;
  fileName: string;
  result: OcrResult | null;
  editedText: string;
  language: string;
  busy: boolean;
  error: string;
  setImage(image: string, fileName: string): void;
  extractImage(image: string, fileName: string): Promise<void>;
  clear(): void;
  setEditedText(value: string): void;
  setLanguage(value: string): void;
  run(): Promise<void>;
  copy(): Promise<void>;
  sendToNote(): Promise<void>;
  discussInChat(): Promise<void>;
  download(): void;
}

export interface OcrOptions {
  gateway?: OcrGateway;
  getTarget(): OcrScope;
  notify(message: string): void;
  saveToNote?(text: string): Promise<void>;
  /** Switch to Chat and prefill the composer with the extracted text. */
  onUseInChat?(text: string): void;
}

export function createOcrStore(options: OcrOptions) {
  const {
    gateway = new OcrHttpGateway(),
    getTarget,
    notify,
    saveToNote,
    onUseInChat,
  } = options;
  return create<OcrState>()((set, get) => ({
    image: "",
    fileName: "",
    result: null,
    editedText: "",
    language: "",
    busy: false,
    error: "",

    setImage(image, fileName) {
      set({ image, fileName, result: null, editedText: "", error: "" });
    },

    async extractImage(image, fileName) {
      set({ image, fileName, result: null, editedText: "", error: "" });
      await get().run();
    },

    clear() {
      set({ image: "", fileName: "", result: null, editedText: "", error: "" });
    },

    setEditedText(value) {
      set({ editedText: value });
    },

    setLanguage(value) {
      set({ language: value });
    },

    async run() {
      const { image, language, busy } = get();
      if (!image || busy) return;
      set({ busy: true, error: "", result: null });
      try {
        const result = await gateway.extract(getTarget(), image, language || undefined);
        set({ result, editedText: result.text, busy: false });
        notify(t("Text extracted"));
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async copy() {
      const { editedText } = get();
      if (!editedText) return;
      try {
        if (typeof navigator.clipboard?.writeText !== "function") {
          throw new Error(t("Clipboard access is not available"));
        }
        await navigator.clipboard.writeText(editedText);
        notify(t("Copied"));
      } catch (error) {
        set({ error: friendlyPluginError(error) });
      }
    },

    async sendToNote() {
      const { editedText } = get();
      if (!saveToNote || !editedText.trim()) return;
      set({ busy: true, error: "" });
      try {
        await saveToNote(editedText);
        set({ busy: false });
        notify(t("Sent to notes"));
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async discussInChat() {
      const { editedText } = get();
      if (!onUseInChat || !editedText.trim()) return;
      onUseInChat(editedText.trim());
      notify(t("Added to chat"));
    },

    download() {
      const { editedText, fileName } = get();
      if (!editedText.trim()) return;
      const baseName = (fileName || "ocr").replace(/\.[^.]+$/, "");
      const blob = new Blob([editedText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${baseName}.txt`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  }));
}

export type OcrStore = ReturnType<typeof createOcrStore>;
