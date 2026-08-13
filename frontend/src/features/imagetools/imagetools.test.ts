import { describe, expect, it, vi } from "vitest";
import { createImageToolsStore, type ImageToolsGateway } from "./imagetoolsStore";
import { formatBytes } from "./imagetoolsLogic";

function stubGateway(overrides: Partial<ImageToolsGateway> = {}): ImageToolsGateway {
  return {
    process: vi.fn(async () => ({
      ok: true,
      fileName: "image-1.png",
      url: "/v2/imagetools/file?workspaceId=ws-1&file=image-1.png",
      width: 640,
      height: 480,
      format: "png",
      bytes: 1024,
    })),
    concat: vi.fn(async () => ({
      ok: true,
      fileName: "image-2.png",
      url: "/v2/imagetools/file?workspaceId=ws-1&file=image-2.png",
      width: 200,
      height: 100,
      format: "png",
      bytes: 2048,
    })),
    ...overrides,
  };
}

function createStore(gateway: ImageToolsGateway) {
  return createImageToolsStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
    notify: vi.fn(),
  });
}

describe("imagetools logic", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(0)).toBe("0 B");
  });
});

describe("imagetools store", () => {
  it("sends process options to the gateway", async () => {
    const process = vi.fn(async () => ({ ok: true, url: "/x" }));
    const store = createStore(stubGateway({ process }));
    store.getState().addImages(["data:image/png;base64,AAAA"], ["a.png"]);
    store.getState().setOption({ resizeEnabled: true, width: 640, height: 480, format: "jpeg", quality: 80, rotate: 90, flip: "horizontal" });
    await store.getState().run();
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        image: "data:image/png;base64,AAAA",
        resize: { width: 640, height: 480, fit: "contain" },
        format: "jpeg",
        quality: 80,
        rotate: 90,
        flip: "horizontal",
      }),
    );
  });

  it("sends concat options to the gateway", async () => {
    const concat = vi.fn(async () => ({ ok: true, url: "/y" }));
    const store = createStore(stubGateway({ concat }));
    store.getState().setMode("concat");
    store.getState().addImages(["data:image/png;base64,AA", "data:image/png;base64,BB"], ["a.png", "b.png"]);
    store.getState().setOption({ columns: 3, gap: 8 });
    await store.getState().run();
    expect(concat).toHaveBeenCalledWith(
      expect.objectContaining({
        images: ["data:image/png;base64,AA", "data:image/png;base64,BB"],
        columns: 3,
        gap: 8,
      }),
    );
  });
});
