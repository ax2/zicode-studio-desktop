import { describe, expect, it, vi } from "vitest";
import { setupVisualAssetsApp } from "./visual-assets-loader.js";

function fixture() {
  let resolve;
  let reject;
  let target = { workspaceId: "first" };
  const pending = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const load = vi.fn(() => pending);
  const invoke = vi.fn();
  const renderedTargets = [];
  const delegate = {
    renderContent: vi.fn((container) => {
      renderedTargets.push(target);
      container.textContent = "Assets";
    }),
    deactivate: vi.fn(),
    setTarget: vi.fn(),
    destroy: vi.fn(),
  };
  const module = { setupVisualAssetsApp: vi.fn(() => delegate) };
  const app = setupVisualAssetsApp({ invoke, getTarget: () => target, load });
  return {
    app,
    load,
    invoke,
    delegate,
    module,
    resolve,
    reject,
    renderedTargets,
    setTarget(value) {
      target = value;
      app.setTarget();
    },
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("visual assets lazy entry", () => {
  it("does no startup work and opens with the latest workspace", async () => {
    const f = fixture();
    f.app.setTarget();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
    const container = document.createElement("div");
    f.app.renderContent(container);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    f.setTarget({ workspaceId: "second" });
    f.resolve(f.module);
    await settle();
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(f.renderedTargets).toEqual([{ workspaceId: "second" }]);
    f.app.setTarget();
    expect(f.delegate.setTarget).toHaveBeenCalledTimes(1);
  });

  it("does not mount over another application after navigation", async () => {
    const f = fixture();
    const container = document.createElement("div");
    f.app.renderContent(container);
    f.app.deactivate();
    container.textContent = "Browser";
    f.resolve(f.module);
    await settle();
    expect(container.textContent).toBe("Browser");
    expect(f.module.setupVisualAssetsApp).not.toHaveBeenCalled();
    f.app.renderContent(container);
    await settle();
    expect(container.textContent).toBe("Assets");
    expect(f.load).toHaveBeenCalledTimes(1);
    f.app.deactivate();
    f.app.setTarget();
    expect(f.delegate.setTarget).not.toHaveBeenCalled();
    f.app.renderContent(container);
    expect(f.module.setupVisualAssetsApp).toHaveBeenCalledTimes(1);
  });

  it("shares a pending import and renders only the latest container", async () => {
    const f = fixture();
    const first = document.createElement("div");
    const second = document.createElement("div");
    f.app.renderContent(first);
    f.app.renderContent(second);
    f.resolve(f.module);
    await settle();
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(f.delegate.renderContent.mock.calls).toEqual([[second]]);
  });

  it("allows retry after failure but ignores a stale retry button", async () => {
    const f = fixture();
    const container = document.createElement("div");
    f.app.renderContent(container);
    f.reject(new Error("private path"));
    await settle();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("private path");
    const staleRetry = container.querySelector("button");
    f.app.deactivate();
    container.textContent = "Browser";
    staleRetry.click();
    expect(container.textContent).toBe("Browser");
    f.load.mockRejectedValueOnce(new Error("offline"));
    f.app.renderContent(container);
    await settle();
    f.load.mockResolvedValue(f.module);
    container.querySelector("button").click();
    await settle();
    expect(container.textContent).toBe("Assets");
    expect(f.load).toHaveBeenCalledTimes(3);
  });

  it("never initializes after destruction and destroys a mounted view once", async () => {
    const f = fixture();
    const container = document.createElement("div");
    f.app.renderContent(container);
    f.app.destroy();
    f.resolve(f.module);
    await settle();
    f.app.renderContent(container);
    expect(f.module.setupVisualAssetsApp).not.toHaveBeenCalled();
    const mounted = fixture();
    mounted.app.renderContent(container);
    mounted.resolve(mounted.module);
    await settle();
    mounted.app.destroy();
    mounted.app.destroy();
    mounted.app.setTarget();
    expect(mounted.delegate.destroy).toHaveBeenCalledTimes(1);
    expect(mounted.delegate.setTarget).not.toHaveBeenCalled();
  });
});
