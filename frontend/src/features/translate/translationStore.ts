import { create } from "zustand";
import { t } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";
import type { TranslationResult } from "./translationLogic";

export interface TranslationScope {
  sceneId: string;
  workspaceId: string;
}

export interface TranslateInput {
  text: string;
  targetLang: string;
  sourceLang?: string;
  model?: string;
}

export interface TranslationGateway {
  translate(scope: TranslationScope, input: TranslateInput): Promise<TranslationResult>;
}

export class TranslationHttpGateway implements TranslationGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Translation gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
  }

  async translate(scope: TranslationScope, input: TranslateInput): Promise<TranslationResult> {
    const response = await this.#fetch(
      new URL("/v2/translate", this.#location.origin).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, ...input }),
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
      throw new Error(detail || `translation failed (${response.status})`);
    }
    return (await response.json()) as TranslationResult;
  }
}

export interface TranslationState {
  text: string;
  sourceLang: string;
  targetLang: string;
  result: TranslationResult | null;
  editedText: string;
  busy: boolean;
  error: string;
  setText(value: string): void;
  setSourceLang(value: string): void;
  setTargetLang(value: string): void;
  swap(): void;
  run(): Promise<void>;
  copyResult(): Promise<void>;
  setEditedText(value: string): void;
  download(): void;
}

export interface TranslationOptions {
  gateway?: TranslationGateway;
  getTarget(): TranslationScope;
  notify(message: string): void;
}

export function createTranslationStore(options: TranslationOptions) {
  const { gateway = new TranslationHttpGateway(), getTarget, notify } = options;
  return create<TranslationState>()((set, get) => ({
    text: "",
    sourceLang: "",
    targetLang: "Chinese",
    result: null,
    editedText: "",
    busy: false,
    error: "",

    setText(value) {
      set({ text: value, error: "", result: null });
    },

    setSourceLang(value) {
      set({ sourceLang: value, error: "" });
    },

    setTargetLang(value) {
      set({ targetLang: value, error: "" });
    },

    swap() {
      const { sourceLang, targetLang, editedText, text } = get();
      set({
        sourceLang: targetLang,
        targetLang: sourceLang || "English",
        // With a previous result, swap the translated text into the source.
        // Without one, keep the source text so swapping languages never
        // clears what the user typed.
        text: editedText || text,
        result: null,
        editedText: "",
        error: "",
      });
    },

    async run() {
      const { text, sourceLang, targetLang, busy } = get();
      if (!text.trim() || busy) return;
      set({ busy: true, error: "", result: null });
      try {
        const result = await gateway.translate(getTarget(), {
          text,
          targetLang,
          ...(sourceLang ? { sourceLang } : {}),
        });
        set({ result, editedText: result.translated, busy: false });
        notify(t("Translation complete"));
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async copyResult() {
      const { editedText } = get();
      if (!editedText) return;
      try {
        if (typeof navigator.clipboard?.writeText !== "function") {
          throw new Error(t("Clipboard access is not available"));
        }
        await navigator.clipboard.writeText(editedText);
        notify(t("Copied"));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },

    setEditedText(value) {
      set({ editedText: value });
    },

    download() {
      const { editedText } = get();
      if (!editedText.trim()) return;
      const blob = new Blob([editedText], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "translation.txt";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  }));
}

export type TranslationStore = ReturnType<typeof createTranslationStore>;
