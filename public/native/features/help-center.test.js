import { afterEach, describe, expect, it, vi } from "vitest";
import { setupHelpCenter } from "./help-center.js";

function render() {
  document.body.innerHTML = `
    <button id="help-btn">Help</button>
    <div id="help-center-overlay" class="hidden"></div>
    <section id="help-center" class="hidden">
      <button id="help-center-close">Close</button>
      <span id="help-center-page-title"></span>
      <div class="help-center-layout">
        <nav id="help-center-navigation"></nav>
        <article id="help-center-article"></article>
        <nav id="help-center-toc"></nav>
      </div>
    </section>
  `;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("help center", () => {
  it("loads the manifest, renders Markdown, and builds page navigation", async () => {
    render();
    const fetchImpl = vi.fn(async (url) => {
      if (url === "/help/manifest.json") {
        return {
          ok: true,
          json: async () => ({
            sections: ["使用指南"],
            pages: [
              {
                id: "getting-started",
                title: "快速开始",
                section: "使用指南",
                file: "getting-started.md",
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        text: async () => "# 快速开始\n\n## 创建会话\n\n选择场景。",
      };
    });
    const help = setupHelpCenter({ fetchImpl, getLocaleImpl: () => "zh-CN" });

    await help.open();

    expect(document.getElementById("help-center").classList.contains("hidden")).toBe(false);
    expect(document.getElementById("help-center-article").textContent).toContain("创建会话");
    expect(document.querySelector(".help-center-nav-link").textContent).toBe("快速开始");
    expect(document.querySelector(".help-center-tree-branch").open).toBe(true);
    expect(document.querySelector(".help-center-tree-icon").textContent).toBe("✦");
    expect(document.querySelector(".help-center-toc-link").getAttribute("href")).toBe("#创建会话");
    expect(document.querySelector(".help-center-toc-title").textContent).toBe("本页目录");
    expect(document.querySelector(".help-center-hero").textContent).toContain("快速开始");
    expect(document.querySelector(".help-center-search").textContent).toContain("⌕");
  });

  it("opens from the visible Help button and closes with Escape", async () => {
    render();
    const fetchImpl = vi.fn(async (url) =>
      url.endsWith("manifest.json")
        ? {
            ok: true,
            json: async () => ({
              sections: [],
              pages: [{ id: "getting-started", title: "Start", file: "getting-started.md" }],
            }),
          }
        : { ok: true, text: async () => "# Start" },
    );
    setupHelpCenter({ fetchImpl, getLocaleImpl: () => "zh-CN" });

    document.getElementById("help-btn").click();
    await vi.waitFor(() =>
      expect(document.getElementById("help-center").classList.contains("hidden")).toBe(false),
    );
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("help-center").classList.contains("hidden")).toBe(true);
  });

  it("loads the English help catalog when the interface language is English", async () => {
    render();
    const fetchImpl = vi.fn(async (url) =>
      url.endsWith("manifest.json")
        ? {
            ok: true,
            json: async () => ({
              sections: ["Getting started"],
              pages: [
                {
                  id: "getting-started",
                  title: "Quick start",
                  file: "getting-started.md",
                },
              ],
            }),
          }
        : { ok: true, text: async () => "# Quick start\n\n## Create a session" },
    );
    const help = setupHelpCenter({ fetchImpl, getLocaleImpl: () => "en" });

    await help.open();

    expect(fetchImpl).toHaveBeenCalledWith("/help/en/manifest.json");
    expect(fetchImpl).toHaveBeenCalledWith("/help/en/getting-started.md");
    expect(document.getElementById("help-center-article").textContent).toContain(
      "Create a session",
    );
  });

  it("filters the documentation tree and renders previous/next navigation", async () => {
    render();
    const pages = [
      { id: "getting-started", title: "快速开始", section: "指南", file: "start.md" },
      { id: "models", title: "模型设置", section: "配置", file: "models.md" },
    ];
    const fetchImpl = vi.fn(async (url) =>
      url.endsWith("manifest.json")
        ? { ok: true, json: async () => ({ sections: ["指南", "配置"], pages }) }
        : { ok: true, text: async () => "# 文档\n\n简介\n\n## 详情" },
    );
    const help = setupHelpCenter({ fetchImpl, getLocaleImpl: () => "zh-CN" });

    await help.open();
    expect(document.querySelector(".help-center-pager-link--next").textContent).toContain(
      "模型设置",
    );

    const search = document.querySelector(".help-center-search input");
    search.value = "模型";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll(".help-center-nav-link")).toHaveLength(1);
    expect(document.querySelector(".help-center-nav-link").textContent).toBe("模型设置");

    search.value = "不存在";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelector(".help-center-search-empty").textContent).toContain("没有匹配");
  });
});
