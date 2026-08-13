import { create } from "zustand";
import { t } from "../../shared/i18n";
import type { OcrResult } from "./ocrLogic";

export interface OcrScope {
  sceneId: string;
  workspaceId: string;
}

export interface OcrGateway {
  extract(scope: OcrScope, image: string): Promise<OcrResult>;
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

  async extract(scope: OcrScope, image: string): Promise<OcrResult> {
    const response = await this.#fetch(
      new URL("/v2/ocr/extract", this.#location.origin).toString(),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...scope, image }),
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
  busy: boolean;
  error: string;
  setImage(image: string, fileName: string): void;
  clear(): void;
  run(): Promise<void>;
  copy(): Promise<void>;
}

export interface OcrOptions {
  gateway?: OcrGateway;
  getTarget(): OcrScope;
  notify(message: string): void;
}

export function createOcrStore(options: OcrOptions) {
  const { gateway = new OcrHttpGateway(), getTarget, notify } = options;
  return create<OcrState>()((set, get) => ({
    image: "",
    fileName: "",
    result: null,
    busy: false,
    error: "",

    setImage(image, fileName) {
      set({ image, fileName, result: null, error: "" });
    },

    clear() {
      set({ image: "", fileName: "", result: null, error: "" });
    },

    async run() {
      const { image, busy } = get();
      if (!image || busy) return;
      set({ busy: true, error: "", result: null });
      try {
        const result = await gateway.extract(getTarget(), image);
        set({ result, busy: false });
        notify(t("Text extracted"));
      } catch (error) {
        set({ busy: false, error: error instanceof Error ? error.message : String(error) });
      }
    },

    async copy() {
      const { result } = get();
      if (!result) return;
      try {
        await navigator.clipboard?.writeText(result.text);
        notify(t("Copied"));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  }));
}

export type OcrStore = ReturnType<typeof createOcrStore>;
