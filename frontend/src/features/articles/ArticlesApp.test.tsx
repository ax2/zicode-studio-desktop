import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { createArticlesApp } from "./ArticlesApp";

function gatewayStub() {
  return {
    list: vi.fn(async () => ({
      articles: [
        {
          slug: "hello",
          title: "Hello",
          description: "",
          pubDate: null,
          draft: true,
          category: null,
          tags: [],
          authors: [],
          heroImage: null,
          wechatDraftMediaId: null,
          wechatPublishId: null,
          updatedAtMs: null,
        },
      ],
    })),
    read: vi.fn(async () => ({
      slug: "hello",
      title: "Hello",
      description: "",
      pubDate: null,
      draft: true,
      category: null,
      tags: [],
      authors: [],
      heroImage: null,
      wechatDraftMediaId: null,
      wechatPublishId: null,
      updatedAtMs: null,
      markdown: "# Hello\n\nworld",
    })),
    save: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => ({ deleted: true })),
    sync: vi.fn(async () => ({ copied: 0 })),
    getConfig: vi.fn(async () => ({
      wechat: {
        appId: "",
        appSecretSet: false,
        siteUrl: "",
        author: "",
        thumbImagePath: null,
        openComment: true,
        fansCanComment: true,
      },
      blog: {
        host: "",
        username: "",
        passwordSet: false,
        remoteDir: "",
        sourceDir: null,
      },
    })),
    saveConfig: vi.fn(async () => ({ ok: true })),
    wechatSync: vi.fn(async () => ({ mediaId: "", publishId: null })),
    wechatPublish: vi.fn(async () => ({ publishId: "" })),
    blogPublish: vi.fn(async () => ({ uploaded: 0 })),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("articles editor format bar", () => {
  it("wraps the selection in bold from the toolbar", async () => {
    const gateway = gatewayStub();
    const app = createArticlesApp({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "ws-1" }),
      notify: vi.fn(),
    });
    const nav = document.createElement("div");
    const content = document.createElement("div");
    document.body.append(nav, content);
    app.renderNavigation(nav);
    app.renderContent(content);
    await app.refresh();
    await waitFor(() =>
      expect(nav.querySelector(".articles-item")).toBeTruthy(),
    );
    (nav.querySelector(".articles-item") as HTMLElement).click();
    await waitFor(() => expect(content.querySelector(".articles-editor")).toBeTruthy());

    const editTab = [...content.querySelectorAll("button")].find(
      (button) => (button.textContent ?? "").includes("编辑"),
    ) as HTMLButtonElement;
    editTab?.click();
    await waitFor(() => expect(content.querySelector(".articles-format-bar")).toBeTruthy());

    const textarea = content.querySelector(".articles-textarea") as HTMLTextAreaElement;
    textarea.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("textarea value setter missing");
    setter.call(textarea, "hello world");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.setSelectionRange(6, 11);

    const bold = [...content.querySelectorAll(".articles-format-btn")].find(
      (button) => (button.getAttribute("aria-label") ?? "").includes("加粗"),
    ) as HTMLButtonElement;
    expect(bold).toBeTruthy();
    bold.click();
    await waitFor(() => {
      expect(
        (content.querySelector(".articles-textarea") as HTMLTextAreaElement).value,
      ).toBe("hello **world**");
    });

    app.destroy();
    nav.remove();
    content.remove();
  });
});
