import { create } from "zustand";
import { t } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";

export interface IdPhotoLayoutResult {
  ok: boolean;
  fileName?: string;
  url?: string;
  template?: string;
  templateName?: string;
  sheet?: string;
  sheetName?: string;
  cols?: number;
  rows?: number;
  count?: number;
  widthPx?: number;
  heightPx?: number;
  widthMm?: number;
  heightMm?: number;
  mixed?: boolean;
  slots?: Array<{ template: string; templateName: string; count: number }>;
}

export interface IdPhotoLayoutInput {
  sceneId: string;
  workspaceId: string;
  image: string;
  template: string;
  sheet: string;
  background: string;
  tolerance: number;
  borderPx: number;
  cols?: number;
  rows?: number;
  crop?: { x: number; y: number; w: number; h: number };
  slots?: Array<{ template: string; count: number }>;
}

export interface IdPhotoGateway {
  layout(input: IdPhotoLayoutInput): Promise<IdPhotoLayoutResult>;
}

export class IdPhotoHttpGateway implements IdPhotoGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("IdPhoto gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
  }

  async layout(input: IdPhotoLayoutInput): Promise<IdPhotoLayoutResult> {
    const url = new URL("/v2/idphoto/layout", this.#location.origin);
    const response = await this.#fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.error?.message || body?.error?.code || "";
      } catch {
        // ignore
      }
      throw new Error(detail || `idphoto layout failed (${response.status})`);
    }
    return (await response.json()) as IdPhotoLayoutResult;
  }
}

export interface IdPhotoState {
  photo: string;
  photoName: string;
  templateId: string;
  sheetId: string;
  background: string;
  tolerance: number;
  borderPx: number;
  cols: number;
  rows: number;
  autoGrid: boolean;
  mixed: boolean;
  slots: Array<{ template: string; count: number }>;
  crop: { x: number; y: number; w: number; h: number } | null;
  busy: boolean;
  error: string;
  result: IdPhotoLayoutResult | null;
  setPhoto(photo: string, name: string): void;
  setTemplate(templateId: string): void;
  setSheet(sheetId: string): void;
  setBackground(background: string): void;
  setTolerance(tolerance: number): void;
  setBorderPx(borderPx: number): void;
  setGrid(cols: number, rows: number, autoGrid: boolean): void;
  setMixed(mixed: boolean): void;
  setCrop(crop: { x: number; y: number; w: number; h: number } | null): void;
  addSlot(): void;
  removeSlot(index: number): void;
  updateSlot(index: number, template: string, count: number): void;
  layout(): Promise<void>;
  reset(): void;
  resetAll(): void;
}

export interface IdPhotoOptions {
  gateway?: IdPhotoGateway;
  getTarget(): { sceneId: string; workspaceId: string };
  notify(message: string): void;
}

export function createIdPhotoStore(options: IdPhotoOptions) {
  const { gateway = new IdPhotoHttpGateway(), getTarget, notify } = options;
  return create<IdPhotoState>()((set, get) => ({
    photo: "",
    photoName: "",
    templateId: "one_inch",
    sheetId: "6inch",
    background: "keep",
    tolerance: 48,
    borderPx: 2,
    cols: 0,
    rows: 0,
    autoGrid: true,
    mixed: false,
    slots: [{ template: "one_inch", count: 4 }],
    crop: null,
    busy: false,
    error: "",
    result: null,

    setPhoto(photo, name) {
      set({ photo, photoName: name, result: null, error: "" });
    },
    setTemplate(templateId) {
      set({ templateId, result: null, error: "" });
    },
    setSheet(sheetId) {
      set({ sheetId, result: null, error: "" });
    },
    setBackground(background) {
      set({ background, result: null, error: "" });
    },
    setTolerance(tolerance) {
      set({ tolerance, result: null, error: "" });
    },
    setBorderPx(borderPx) {
      set({ borderPx, result: null, error: "" });
    },
    setGrid(cols, rows, autoGrid) {
      set({ cols, rows, autoGrid, result: null, error: "" });
    },
    setMixed(mixed) {
      set({ mixed, result: null, error: "" });
    },
    setCrop(crop) {
      set({ crop, result: null, error: "" });
    },
    addSlot() {
      const slots = [...get().slots, { template: "one_inch", count: 2 }];
      set({ slots, result: null, error: "" });
    },
    removeSlot(index) {
      const slots = get().slots.filter((_, i) => i !== index);
      set({ slots: slots.length > 0 ? slots : [{ template: "one_inch", count: 2 }], result: null, error: "" });
    },
    updateSlot(index, template, count) {
      const slots = get().slots.map((slot, i) =>
        i === index ? { template, count: Math.max(1, count) } : slot,
      );
      set({ slots, result: null, error: "" });
    },

    async layout() {
      const state = get();
      if (!state.photo || state.busy) return;
      const target = getTarget();
      set({ busy: true, error: "", result: null });
      try {
        const result = await gateway.layout({
          sceneId: target.sceneId,
          workspaceId: target.workspaceId,
          image: state.photo,
          template: state.templateId,
          sheet: state.sheetId,
          background: state.background,
          tolerance: state.tolerance,
          borderPx: state.borderPx,
          ...(state.mixed
            ? { slots: state.slots }
            : {
                crop: state.crop ?? undefined,
                ...(state.autoGrid ? {} : { cols: state.cols || undefined, rows: state.rows || undefined }),
              }),
        });
        set({ result, busy: false });
        notify(t("ID photo layout generated"));
      } catch (error) {
        set({
          busy: false,
          error: friendlyPluginError(error),
        });
      }
    },

    reset() {
      set({
        photo: "",
        photoName: "",
        result: null,
        error: "",
        busy: false,
      });
    },

    resetAll() {
      set({
        photo: "",
        photoName: "",
        templateId: "one_inch",
        sheetId: "6inch",
        background: "keep",
        tolerance: 48,
        borderPx: 2,
        cols: 0,
        rows: 0,
        autoGrid: true,
        mixed: false,
        slots: [{ template: "one_inch", count: 4 }],
        crop: null,
        busy: false,
        error: "",
        result: null,
      });
    },
  }));
}

export type IdPhotoStore = ReturnType<typeof createIdPhotoStore>;
