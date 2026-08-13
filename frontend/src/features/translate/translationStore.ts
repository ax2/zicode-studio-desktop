import { create } from "zustand";
import { t } from "../../shared/i18n";
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
      const { sourceLang, targetLang, result } = get();
      set({
        sourceLang: targetLang,
        targetLang: sourceLang || "English",
        text: result?.translated ?? "",
        result: null,
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
        set({ busy: false, error: error instanceof Error ? error.message : String(error) });
      }
    },

    async copyResult() {
      const { editedText } = get();
      if (!editedText) return;
      try {
        await navigator.clipboard?.writeText(editedText);
        notify(t("Copied"));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },

    setEditedText(value) {
      set({ editedText: value });
    },
  }));
}

export type TranslationStore = ReturnType<typeof createTranslationStore>;
