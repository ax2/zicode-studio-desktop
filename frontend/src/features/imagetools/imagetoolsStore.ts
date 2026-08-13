import { create } from "zustand";
import { t } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";
import type { ImageToolResult } from "./imagetoolsLogic";

export interface ProcessInput {
  sceneId: string;
  workspaceId: string;
  image: string;
  resize?: { width?: number; height?: number; fit: string };
  format?: string;
  quality?: number;
  rotate?: number;
  flip?: string;
}

export interface ConcatInput {
  sceneId: string;
  workspaceId: string;
  images: string[];
  columns: number;
  gap: number;
  background?: string;
}

export interface ImageToolsGateway {
  process(input: ProcessInput): Promise<ImageToolResult>;
  concat(input: ConcatInput): Promise<ImageToolResult>;
}

export class ImageToolsHttpGateway implements ImageToolsGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Image Tools gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
  }

  async #post(path: string, body: unknown): Promise<ImageToolResult> {
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
        // ignore
      }
      throw new Error(detail || `image tool failed (${response.status})`);
    }
    return (await response.json()) as ImageToolResult;
  }

  process(input: ProcessInput): Promise<ImageToolResult> {
    return this.#post("/v2/imagetools/process", input);
  }

  concat(input: ConcatInput): Promise<ImageToolResult> {
    return this.#post("/v2/imagetools/concat", input);
  }
}

export interface ImageToolsState {
  mode: "process" | "concat";
  images: string[];
  names: string[];
  resizeEnabled: boolean;
  width: number;
  height: number;
  fit: string;
  format: string;
  quality: number;
  rotate: number;
  flip: string;
  columns: number;
  gap: number;
  busy: boolean;
  error: string;
  result: ImageToolResult | null;
  setMode(mode: "process" | "concat"): void;
  addImages(dataUrls: string[], names: string[]): void;
  removeImage(index: number): void;
  clearImages(): void;
  setOption(patch: Partial<ImageToolsState>): void;
  run(): Promise<void>;
  reset(): void;
}

export interface ImageToolsOptions {
  gateway?: ImageToolsGateway;
  getTarget(): { sceneId: string; workspaceId: string };
  notify(message: string): void;
}

export function createImageToolsStore(options: ImageToolsOptions) {
  const { gateway = new ImageToolsHttpGateway(), getTarget, notify } = options;
  return create<ImageToolsState>()((set, get) => ({
    mode: "process",
    images: [],
    names: [],
    resizeEnabled: false,
    width: 0,
    height: 0,
    fit: "contain",
    format: "png",
    quality: 85,
    rotate: 0,
    flip: "none",
    columns: 2,
    gap: 4,
    busy: false,
    error: "",
    result: null,

    setMode(mode) {
      set({ mode, result: null, error: "" });
    },
    addImages(dataUrls, names) {
      set((state) => ({
        images: state.mode === "process" ? dataUrls.slice(0, 1) : [...state.images, ...dataUrls],
        names: state.mode === "process" ? names.slice(0, 1) : [...state.names, ...names],
        result: null,
        error: "",
      }));
    },
    removeImage(index) {
      set((state) => ({
        images: state.images.filter((_, i) => i !== index),
        names: state.names.filter((_, i) => i !== index),
        result: null,
        error: "",
      }));
    },
    clearImages() {
      set({ images: [], names: [], result: null, error: "" });
    },
    setOption(patch) {
      set({ ...patch, result: null, error: "" });
    },

    async run() {
      const state = get();
      if (state.images.length === 0 || state.busy) return;
      const target = getTarget();
      set({ busy: true, error: "", result: null });
      try {
        const result =
          state.mode === "concat"
            ? await gateway.concat({
                sceneId: target.sceneId,
                workspaceId: target.workspaceId,
                images: state.images,
                columns: state.columns,
                gap: state.gap,
              })
            : await gateway.process({
                sceneId: target.sceneId,
                workspaceId: target.workspaceId,
                image: state.images[0],
                ...(state.resizeEnabled
                  ? {
                      resize: {
                        width: state.width || undefined,
                        height: state.height || undefined,
                        fit: state.fit,
                      },
                    }
                  : {}),
                format: state.format,
                quality: state.format === "png" ? undefined : state.quality,
                rotate: state.rotate || undefined,
                flip: state.flip === "none" ? undefined : state.flip,
              });
        set({ result, busy: false });
        notify(t("Image processed"));
      } catch (error) {
        set({
          busy: false,
          error: friendlyPluginError(error),
        });
      }
    },

    reset() {
      set({
        images: [],
        names: [],
        result: null,
        error: "",
        busy: false,
      });
    },
  }));
}

export type ImageToolsStore = ReturnType<typeof createImageToolsStore>;
