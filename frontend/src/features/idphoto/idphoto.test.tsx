import { describe, expect, it, vi } from "vitest";
import { formatResultSize, IDPHOTO_SHEETS, IDPHOTO_TEMPLATES, templateById } from "./idphotoLogic";
import { createIdPhotoStore, type IdPhotoGateway, type IdPhotoLayoutResult } from "./idphotoStore";

function stubGateway(overrides: Partial<IdPhotoGateway> = {}): IdPhotoGateway {
  return {
    layout: vi.fn(async () => ({
      ok: true,
      fileName: "idphoto-test.png",
      url: "/v2/idphoto/file?workspaceId=ws-1&file=idphoto-test.png",
      template: "one_inch",
      templateName: "一寸",
      sheet: "6inch",
      sheetName: "6寸",
      cols: 3,
      rows: 3,
      count: 9,
      widthPx: 1205,
      heightPx: 1795,
      widthMm: 102,
      heightMm: 152,
    })),
    ...overrides,
  };
}

function createStore(gateway: IdPhotoGateway) {
  return createIdPhotoStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    notify: vi.fn(),
  });
}

describe("idphoto logic", () => {
  it("exposes the core templates and print sheets", () => {
    expect(IDPHOTO_TEMPLATES.map((template) => template.id)).toContain("one_inch");
    expect(IDPHOTO_SHEETS.map((sheet) => sheet.id)).toEqual(["5inch", "6inch", "a4"]);
    expect(templateById("two_inch")?.widthMm).toBe(35);
  });

  it("formats the result summary", () => {
    expect(
      formatResultSize({ widthMm: 102, heightMm: 152, cols: 3, rows: 3 }),
    ).toContain("3列 × 3行");
  });
});

describe("idphoto store", () => {
  it("sends the photo and options to the gateway and stores the result", async () => {
    const layout = vi.fn(async () => ({
      ok: true,
      fileName: "idphoto-test.png",
      url: "/v2/idphoto/file?workspaceId=ws-1&file=idphoto-test.png",
      template: "one_inch",
      templateName: "一寸",
      sheet: "6inch",
      sheetName: "6寸",
      cols: 3,
      rows: 3,
      count: 9,
      widthPx: 1205,
      heightPx: 1795,
      widthMm: 102,
      heightMm: 152,
    }));
    const store = createStore(stubGateway({ layout }));
    store.getState().setPhoto("data:image/png;base64,AAAA", "photo.png");
    store.getState().setTemplate("two_inch");
    store.getState().setSheet("a4");
    store.getState().setBackground("red");
    store.getState().setTolerance(60);
    await store.getState().layout();
    expect(layout).toHaveBeenCalledWith({
      sceneId: "programming",
      workspaceId: "ws-1",
      image: "data:image/png;base64,AAAA",
      template: "two_inch",
      sheet: "a4",
      background: "red",
      tolerance: 60,
      borderPx: 2,
    });
    expect(store.getState().result?.count).toBe(9);
    expect(store.getState().busy).toBe(false);
  });

  it("passes a manual grid when auto fit is disabled", async () => {
    const layout = vi.fn(async () => ({ ok: true } as IdPhotoLayoutResult));
    const store = createStore(stubGateway({ layout }));
    store.getState().setPhoto("data:image/png;base64,AAAA", "photo.png");
    store.getState().setGrid(2, 4, false);
    await store.getState().layout();
    expect(layout).toHaveBeenCalledWith(
      expect.objectContaining({
        cols: 2,
        rows: 4,
      }),
    );
  });

  it("sends mixed slots instead of a single template", async () => {
    const layout = vi.fn(async () => ({ ok: true } as IdPhotoLayoutResult));
    const store = createStore(stubGateway({ layout }));
    store.getState().setPhoto("data:image/png;base64,AAAA", "photo.png");
    store.getState().setMixed(true);
    store.getState().updateSlot(0, "two_inch", 3);
    store.getState().addSlot();
    store.getState().updateSlot(1, "one_inch", 2);
    await store.getState().layout();
    expect(layout).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [
          { template: "two_inch", count: 3 },
          { template: "one_inch", count: 2 },
        ],
      }),
    );
  });

  it("sends the crop rectangle for single-template layout", async () => {
    const layout = vi.fn(async () => ({ ok: true } as IdPhotoLayoutResult));
    const store = createStore(stubGateway({ layout }));
    store.getState().setPhoto("data:image/png;base64,AAAA", "photo.png");
    store.getState().setCrop({ x: 0.1, y: 0.2, w: 0.8, h: 0.7 });
    await store.getState().layout();
    expect(layout).toHaveBeenCalledWith(
      expect.objectContaining({ crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.7 } }),
    );
  });

  it("surfaces gateway errors without clearing the photo", async () => {
    const layout = vi.fn(async () => {
      throw new Error("layout failed");
    });
    const store = createStore(stubGateway({ layout }));
    store.getState().setPhoto("data:image/png;base64,AAAA", "photo.png");
    await store.getState().layout();
    expect(store.getState().error).toContain("layout failed");
    expect(store.getState().photo).toBe("data:image/png;base64,AAAA");
  });
});
