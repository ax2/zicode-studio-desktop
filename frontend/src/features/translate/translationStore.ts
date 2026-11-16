import { create } from "zustand";
import { friendlyPluginError } from "../../shared/hostErrors";
import { t } from "../../shared/i18n";
import type { ModelToolChoice, ModelToolSelection } from "../../shared/ModelToolPicker";
import type { TranslationResult } from "./translationLogic";

export interface TranslationScope {
  sceneId: string;
  workspaceId: string;
}

export interface TranslateInput {
  provider?: string;
  text: string;
  targetLang: string;
  sourceLang?: string;
  model?: string;
}

export interface TranslationGateway {
  listModels?(scope: TranslationScope): Promise<ModelToolChoice[]>;
  translate(scope: TranslationScope, input: TranslateInput, signal?: AbortSignal): Promise<TranslationResult>;
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

  async listModels(scope: TranslationScope): Promise<ModelToolChoice[]> {
    const url = new URL("/v2/model-tools/models", this.#location.origin);
    url.searchParams.set("sceneId", scope.sceneId);
    url.searchParams.set("purpose", "translation");
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error("model_config_unavailable");
    return (await response.json()).models;
  }

  async translate(scope: TranslationScope, input: TranslateInput, signal?: AbortSignal): Promise<TranslationResult> {
    const response = await this.#fetch(
      new URL("/v2/translate", this.#location.origin).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, ...input }),
        signal,
      },
    ).catch((error) => {
      if (signal?.aborted) throw error;
      throw new Error("model gateway is unreachable");
    });
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

type IncomingText = {
  source: "webpage" | "clipboard";
  text: string;
  scope: TranslationScope;
};

const sameScope = (a: TranslationScope, b: TranslationScope) =>
  a.sceneId === b.sceneId && a.workspaceId === b.workspaceId;

const maxTextCharacters = 50_000;

export interface TranslationState {
  modelSelection: ModelToolSelection | null;
  setModelSelection(value: ModelToolSelection | null): void;
  getSceneId(): string;
  getScope(): TranslationScope;
  pendingIncomingText: IncomingText | null;
  stageBrowserSelection(value: string): void;
  importClipboard(): Promise<void>;
  acceptIncomingText(): void;
  dismissIncomingText(): void;
  loadModels(): Promise<ModelToolChoice[]>;
  text: string;
  sourceLang: string;
  targetLang: string;
  result: TranslationResult | null;
  editedText: string;
  busy: boolean;
  error: string;
  cancelled: boolean;
  setText(value: string): void;
  setSourceLang(value: string): void;
  setTargetLang(value: string): void;
  swap(): void;
  run(): Promise<void>;
  cancel(): void;
  copyResult(): Promise<void>;
  setEditedText(value: string): void;
  download(): void;
  clear(): void;
}

export interface TranslationOptions {
  gateway?: TranslationGateway;
  getTarget(): TranslationScope;
  notify(message: string): void;
}

export function createTranslationStore(options: TranslationOptions) {
  const { gateway = new TranslationHttpGateway(), getTarget, notify } = options;
  let inputRevision = 0;
  let incomingRevision = 0;
  let activeRequest: AbortController | null = null;
  let completedInput: { scope: TranslationScope; text: string; sourceLang: string; targetLang: string } | null = null;
  function stageIncomingText(text: string, source: IncomingText["source"], scope: TranslationScope) {
    const current = store.getState();
    if (!current.text.trim() && !current.busy && !current.result) current.setText(text);
    store.setState({ pendingIncomingText: text !== store.getState().text ? { text, source, scope } : null });
  }

  const store = create<TranslationState>()((set, get) => ({
    modelSelection: null,
    setModelSelection(value) {
      const previous = get().modelSelection;
      if (previous?.sceneId === value?.sceneId && previous?.provider === value?.provider && previous?.model === value?.model) return;
      inputRevision += 1;
      set({ modelSelection: value ? { ...value } : null, error: "", cancelled: false });
    },
    getSceneId: () => getTarget().sceneId,
    getScope: getTarget,
    pendingIncomingText: null,
    stageBrowserSelection(text) {
      if (!text.trim()) return;
      incomingRevision += 1;
      stageIncomingText(text, "webpage", { ...getTarget() });
    },
    async importClipboard() {
      const scope = { ...getTarget() };
      const revision = ++incomingRevision;
      const isCurrent = () => incomingRevision === revision && sameScope(scope, getTarget());
      let text: string;
      try {
        if (typeof navigator.clipboard?.readText !== "function") throw new Error("clipboard_unavailable");
        text = await navigator.clipboard.readText();
      } catch {
        if (isCurrent()) set({ error: t("Could not read text from the clipboard") });
        return;
      }
      if (!isCurrent()) return;
      if (!text.trim()) {
        set({ error: t("Clipboard contains no text") });
        return;
      }
      if (text.length > maxTextCharacters * 2 ||
          (text.length > maxTextCharacters && Array.from(text).length > maxTextCharacters)) {
        set({ error: t("Clipboard text exceeds the 50,000-character translation limit") });
        return;
      }
      set({ error: "" });
      stageIncomingText(text, "clipboard", scope);
    },
    acceptIncomingText() {
      const { pendingIncomingText: pending, busy } = get();
      if (!pending || busy) return;
      if (sameScope(pending.scope, getTarget())) get().setText(pending.text);
      set({ pendingIncomingText: null });
    },
    dismissIncomingText() {
      incomingRevision += 1;
      set({ pendingIncomingText: null });
    },
    loadModels: () => gateway.listModels?.(getTarget()) ?? Promise.resolve([]),
    text: "",
    sourceLang: "",
    targetLang: "Chinese",
    result: null,
    editedText: "",
    busy: false,
    error: "",
    cancelled: false,

    setText(value) {
      if (value === get().text) return;
      inputRevision += 1;
      completedInput = null;
      set({ text: value, error: "", cancelled: false, result: null, editedText: "" });
    },

    setSourceLang(value) {
      if (value === get().sourceLang) return;
      inputRevision += 1;
      set({ sourceLang: value, error: "", cancelled: false });
    },

    setTargetLang(value) {
      if (value === get().targetLang) return;
      inputRevision += 1;
      set({ targetLang: value, error: "", cancelled: false });
    },

    swap() {
      const { sourceLang, targetLang, editedText, text, result } = get();
      const scope = getTarget();
      const currentResult = result && completedInput && completedInput.text === text &&
        completedInput.sourceLang === sourceLang && completedInput.targetLang === targetLang &&
        completedInput.scope.sceneId === scope.sceneId && completedInput.scope.workspaceId === scope.workspaceId;
      inputRevision += 1;
      completedInput = null;
      set({
        sourceLang: targetLang,
        targetLang: sourceLang || "English",
        // With a previous result, swap the translated text into the source.
        // Without one, keep the source text so swapping languages never
        // clears what the user typed.
        text: currentResult ? editedText : text,
        result: null,
        editedText: "",
        error: "",
        cancelled: false,
      });
    },

    async run() {
      const { text, sourceLang, targetLang, busy } = get();
      if (!text.trim() || busy) return;
      const scope = { ...getTarget() };
      const revision = inputRevision;
      const selection = get().modelSelection;
      if (!selection || selection.sceneId !== scope.sceneId) { set({ error: t("Choose a configured model"), cancelled: false }); return; }
      const request = new AbortController();
      activeRequest = request;
      const acceptCompletion = () => {
        if (activeRequest !== request) return false;
        activeRequest = null;
        const current = getTarget();
        if (current.sceneId !== scope.sceneId || current.workspaceId !== scope.workspaceId) {
          set({ busy: false });
          return false;
        }
        if (inputRevision !== revision) {
          set({ busy: false, error: get().text.trim() ? t("Translation input changed. Translate again when ready.") : "" });
          return false;
        }
        return true;
      };
      set({ busy: true, error: "", cancelled: false, result: null, editedText: "" });
      try {
        const result = await gateway.translate(scope, {
          provider: selection.provider, model: selection.model,
          text,
          targetLang,
          ...(sourceLang ? { sourceLang } : {}),
        }, request.signal);
        if (!acceptCompletion()) return;
        completedInput = { scope, text, sourceLang, targetLang };
        set({ result, editedText: result.translated, busy: false });
        notify(t("Translation complete"));
      } catch (error) {
        if (acceptCompletion()) set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    cancel() {
      const request = activeRequest;
      if (!request) return;
      activeRequest = null;
      request.abort();
      set({ busy: false, error: "", cancelled: true });
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

    clear() {
      inputRevision += 1;
      incomingRevision += 1;
      completedInput = null;
      set({ text: "", pendingIncomingText: null, result: null, editedText: "", error: "", cancelled: false });
    },
  }));
  return store;
}

export type TranslationStore = ReturnType<typeof createTranslationStore>;
