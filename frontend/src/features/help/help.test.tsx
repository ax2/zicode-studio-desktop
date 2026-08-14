import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelpMain, HelpNav } from "./HelpCenterApp";
import { createHelpStore } from "./store";

const PAGES = [
  {
    id: "getting-started",
    title: "快速开始",
    section: "使用指南",
    file: "getting-started.md",
  },
];

function mockFetch(): typeof fetch {
  const impl = vi.fn(async (url: string | URL | Request) => {
    const urlText = String(url);
    if (urlText.endsWith("manifest.json")) {
      return {
        ok: true,
        json: async () => ({
          sections: ["使用指南"],
          pages: PAGES,
        }),
      } as Response;
    }
    return {
      ok: true,
      text: async () => "# 快速开始\n\n## 创建会话\n\n选择场景。",
    } as Response;
  });
  return impl as unknown as typeof fetch;
}

function renderHelp(fetchImpl: typeof fetch) {
  const store = createHelpStore({ fetchImpl, getLocaleImpl: () => "zh-CN" });
  render(
    <div>
      <HelpNav store={store} />
      <HelpMain store={store} />
    </div>,
  );
  void store.getState().loadManifest();
  void store.getState().loadPage("getting-started");
  return store;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("help center React app", () => {
  it("loads the manifest, renders Markdown, and builds page navigation", async () => {
    const fetchImpl = mockFetch();
    renderHelp(fetchImpl);

    await waitFor(() => expect(screen.getByText("快速开始")).toBeTruthy());
    expect(document.querySelector(".help-center-tree-icon")?.textContent).toBe("✦");
    expect(
      (document.querySelector(".help-center-tree-branch") as HTMLDetailsElement | null)?.open,
    ).toBe(true);
    expect(document.querySelector(".help-center-article")?.textContent).toContain("创建会话");
    expect(document.querySelector(".help-center-hero")?.textContent).toContain("快速开始");
    expect(document.querySelector(".help-center-toc-title")?.textContent).toBe("本页目录");
    expect(document.querySelector(".help-center-toc-link")?.textContent).toBe("创建会话");
  });

  it("filters the documentation tree by search query", async () => {
    const fetchImpl = mockFetch();
    const store = renderHelp(fetchImpl);
    await waitFor(() => expect(screen.getByText("快速开始")).toBeTruthy());
    const searchInput = document.querySelector(".help-center-search input");
    if (!(searchInput instanceof HTMLInputElement)) {
      throw new Error("help search input missing");
    }
    fireEvent.change(searchInput, {
      target: { value: "不存在" },
    });
    await waitFor(() =>
      expect(document.querySelector(".help-center-search-empty")?.textContent).toBe(
        "没有匹配的帮助内容",
      ),
    );
    store.getState().setSearch("");
  });

  it("opens through the embedded open handler", async () => {
    const fetchImpl = mockFetch();
    const { createHelpCenterApp } = await import("./HelpCenterApp");
    const app = createHelpCenterApp({ fetchImpl, getLocaleImpl: () => "zh-CN" });
    const handler = vi.fn();
    app.setOpenHandler(handler);
    await app.open("getting-started");
    expect(handler).toHaveBeenCalledWith("getting-started");
    expect(fetchImpl).toHaveBeenCalledWith("/help/getting-started.md");
  });

  it("localizes help load errors through the injected translator", async () => {
    const failing = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    const store = createHelpStore({
      fetchImpl: failing as unknown as typeof fetch,
      getLocaleImpl: () => "zh-CN",
      translateImpl: (source) =>
        source === "Help index could not be loaded" ? "无法加载帮助索引" : source,
    });
    await expect(store.getState().loadManifest()).rejects.toThrow("无法加载帮助索引");
  });
});
