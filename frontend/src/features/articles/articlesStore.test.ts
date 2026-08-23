import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createArticlesStore,
  slugifyTitle,
  suggestSlugFromMarkdown,
  titleFromMarkdown,
  type ArticlesGateway,
} from "./articlesStore";

function mockGateway(overrides: Partial<ArticlesGateway> = {}): ArticlesGateway {
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
      markdown: "# Hello\n",
    })),
    save: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => ({ deleted: true })),
    sync: vi.fn(async () => ({ copied: 3 })),
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
    wechatSync: vi.fn(async () => ({ mediaId: "media-1", publishId: null })),
    wechatPublish: vi.fn(async () => ({ publishId: "pub-1" })),
    blogPublish: vi.fn(async () => ({ uploaded: 5 })),
    ...overrides,
  };
}

function makeStore(gateway: ArticlesGateway) {
  const notify = vi.fn();
  const store = createArticlesStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "workspace-a" }),
    notify,
  });
  return { store, notify };
}

describe("articles store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the article list through the gateway", async () => {
    const gateway = mockGateway();
    const { store } = makeStore(gateway);
    await store.getState().load();
    expect(gateway.list).toHaveBeenCalledWith({
      sceneId: "programming",
      workspaceId: "workspace-a",
    });
    expect(store.getState().articles).toHaveLength(1);
    expect(store.getState().articles[0].slug).toBe("hello");
    expect(store.getState().busy).toBe(false);
  });

  it("opens an article into the draft and autosaves edits", async () => {
    const gateway = mockGateway();
    const { store } = makeStore(gateway);
    await store.getState().open("hello");
    expect(store.getState().draftSlug).toBe("hello");
    expect(store.getState().draftMarkdown).toBe("# Hello\n");

    store.getState().setMarkdown("# Hello, updated\n");
    await vi.advanceTimersByTimeAsync(1500);
    expect(gateway.save).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "workspace-a" },
      "hello",
      "# Hello, updated\n",
    );
  });

  it("requires a slug before saving", async () => {
    const gateway = mockGateway();
    const { store } = makeStore(gateway);
    store.getState().newArticle();
    await store.getState().save();
    expect(gateway.save).not.toHaveBeenCalled();
    expect(store.getState().error).toBeTruthy();
  });

  it("saves an article with a slug and refreshes the list", async () => {
    const gateway = mockGateway();
    const { store, notify } = makeStore(gateway);
    store.getState().newArticle();
    store.getState().setSlug("hello");
    store.getState().setMarkdown("# Saved\n");
    await store.getState().save();
    expect(gateway.save).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
    expect(gateway.list).toHaveBeenCalled();
    expect(store.getState().current?.slug).toBe("hello");
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().savedAtMs).toBeTypeOf("number");
  });

  it("marks the draft dirty on edits and clears it after an autosave", async () => {
    const gateway = mockGateway();
    const { store } = makeStore(gateway);
    store.getState().newArticle();
    expect(store.getState().dirty).toBe(false);
    store.getState().setSlug("hello");
    store.getState().setMarkdown("# Edited\n");
    expect(store.getState().dirty).toBe(true);
    await store.getState().save(true);
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().savedAtMs).toBeTypeOf("number");
  });

  it("deletes an article and clears the draft", async () => {
    const gateway = mockGateway();
    const { store } = makeStore(gateway);
    await store.getState().open("hello");
    await store.getState().remove("hello");
    expect(gateway.delete).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "workspace-a" },
      "hello",
    );
    expect(store.getState().draftSlug).toBe("");
  });

  it("syncs from the source directory and notifies the copied count", async () => {
    const gateway = mockGateway();
    const { store, notify } = makeStore(gateway);
    await store.getState().syncFromSource("C:\\blog");
    expect(gateway.sync).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "workspace-a" },
      "C:\\blog",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("3") }),
    );
  });

  it("syncs and publishes to WeChat, then refreshes", async () => {
    const gateway = mockGateway();
    const { store, notify } = makeStore(gateway);
    store.getState().newArticle();
    store.getState().setSlug("hello");
    await store.getState().syncWechat(false);
    expect(gateway.wechatSync).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "workspace-a" },
      "hello",
      false,
    );
    expect(store.getState().notice).toContain("media-1");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/draft|草稿/) }),
    );

    await store.getState().publishWechat();
    expect(gateway.wechatPublish).toHaveBeenCalledWith(
      { sceneId: "programming", workspaceId: "workspace-a" },
      "hello",
    );
  });

  it("publishes the blog and reports uploaded file count", async () => {
    const gateway = mockGateway();
    const { store, notify } = makeStore(gateway);
    await store.getState().publishBlog();
    expect(gateway.blogPublish).toHaveBeenCalledWith({
      sceneId: "programming",
      workspaceId: "workspace-a",
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("5") }),
    );
  });

  it("surfaces gateway failures as friendly errors", async () => {
    const gateway = mockGateway({
      list: vi.fn(async () => {
        throw new Error("articles failed (500)");
      }),
    });
    const { store } = makeStore(gateway);
    await store.getState().load();
    expect(store.getState().error).toBeTruthy();
    expect(store.getState().busy).toBe(false);
  });
});

describe("article slug helpers", () => {
  it("slugifies ASCII titles and reads the frontmatter title", () => {
    expect(slugifyTitle("Hello World!")).toBe("hello-world");
    expect(slugifyTitle("  Multi--Space  Test  ")).toBe("multi-space-test");
    expect(slugifyTitle("纯中文标题")).toBe("");
    expect(
      titleFromMarkdown('---\ntitle: "My Post"\n---\n\nbody'),
    ).toBe("My Post");
  });

  it("auto-suggests a slug from the title when the slug is empty", async () => {
    const gateway = mockGateway();
    const { store } = makeStore(gateway);
    store.getState().newArticle();
    store
      .getState()
      .setMarkdown('---\ntitle: "Hello World"\n---\n\ncontent');
    expect(store.getState().draftSlug).toBe("hello-world");
  });

  it("falls back to a usable slug for non-ASCII frontmatter titles", () => {
    expect(
      suggestSlugFromMarkdown('---\ntitle: "纯中文标题"\n---\n\ncontent'),
    ).toMatch(/^article-\d+$/);
    const gateway = mockGateway();
    const { store } = makeStore(gateway);
    store.getState().newArticle();
    store
      .getState()
      .setMarkdown('---\ntitle: "纯中文标题"\n---\n\ncontent');
    expect(store.getState().draftSlug).toMatch(/^article-\d+$/);
  });

  it("keeps a manually entered slug when the markdown changes", async () => {
    const gateway = mockGateway();
    const { store } = makeStore(gateway);
    store.getState().newArticle();
    store.getState().setSlug("custom-slug");
    store
      .getState()
      .setMarkdown('---\ntitle: "Hello World"\n---\n\ncontent');
    expect(store.getState().draftSlug).toBe("custom-slug");
  });
});
