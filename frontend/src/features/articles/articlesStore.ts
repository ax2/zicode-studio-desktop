import { create } from "zustand";
import { t } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";

const AUTOSAVE_DELAY_MS = 1200;

export interface ArticlesScope {
  sceneId: string;
  workspaceId: string;
}

export interface ArticleSummary {
  slug: string;
  title: string;
  description: string;
  pubDate: string | null;
  draft: boolean;
  category: string | null;
  tags: string[];
  authors: string[];
  heroImage: string | null;
  wechatDraftMediaId: string | null;
  wechatPublishId: string | null;
  updatedAtMs: number | null;
}

export interface Article {
  slug: string;
  title: string;
  description: string;
  pubDate: string | null;
  draft: boolean;
  category: string | null;
  tags: string[];
  authors: string[];
  heroImage: string | null;
  wechatDraftMediaId: string | null;
  wechatPublishId: string | null;
  updatedAtMs: number | null;
  markdown: string;
}

export interface ArticlesConfig {
  wechat: {
    appId: string;
    appSecretSet: boolean;
    siteUrl: string;
    author: string;
    thumbImagePath: string | null;
    openComment: boolean;
    fansCanComment: boolean;
  };
  blog: {
    host: string;
    username: string;
    passwordSet: boolean;
    remoteDir: string;
    sourceDir: string | null;
  };
}

export interface SaveArticlesConfig {
  wechat: {
    appId: string;
    appSecret: string;
    siteUrl: string;
    author: string;
    thumbImagePath: string | null;
    openComment: boolean;
    fansCanComment: boolean;
  };
  blog: {
    host: string;
    username: string;
    password: string;
    remoteDir: string;
    sourceDir: string | null;
    resetHostKey?: boolean;
  };
}

export interface ArticlesGateway {
  list(scope: ArticlesScope): Promise<{ articles: ArticleSummary[] }>;
  read(scope: ArticlesScope, slug: string): Promise<Article>;
  save(scope: ArticlesScope, slug: string, markdown: string): Promise<{ ok: boolean }>;
  delete(scope: ArticlesScope, slug: string): Promise<{ deleted: boolean }>;
  sync(scope: ArticlesScope, sourceDir: string): Promise<{ copied: number }>;
  getConfig(scope: ArticlesScope): Promise<ArticlesConfig>;
  saveConfig(scope: ArticlesScope, config: SaveArticlesConfig): Promise<{ ok: boolean }>;
  wechatSync(
    scope: ArticlesScope,
    slug: string,
    publish: boolean,
  ): Promise<{ mediaId: string; publishId: string | null }>;
  wechatPublish(scope: ArticlesScope, slug: string): Promise<{ publishId: string }>;
  blogPublish(scope: ArticlesScope): Promise<{ uploaded: number }>;
}

export class ArticlesHttpGateway implements ArticlesGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Articles gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
  }

  async #request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await this.#fetch(new URL(path, this.#location.origin).toString(), {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = await response.json();
        detail = parsed?.error?.message || parsed?.error?.code || "";
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new Error(detail || `articles failed (${response.status})`);
    }
    return response.json();
  }

  async list(scope: ArticlesScope) {
    const url = new URL("/v2/articles", this.#location.origin);
    url.searchParams.set("sceneId", scope.sceneId);
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error(`articles failed (${response.status})`);
    return response.json() as Promise<{ articles: ArticleSummary[] }>;
  }

  async read(scope: ArticlesScope, slug: string) {
    const url = new URL("/v2/articles/article", this.#location.origin);
    url.searchParams.set("sceneId", scope.sceneId);
    url.searchParams.set("slug", slug);
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error(`articles failed (${response.status})`);
    return response.json() as Promise<Article>;
  }

  save(scope: ArticlesScope, slug: string, markdown: string) {
    return this.#request("/v2/articles/save", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId, slug, markdown }),
    }) as Promise<{ ok: boolean }>;
  }

  delete(scope: ArticlesScope, slug: string) {
    return this.#request("/v2/articles/delete", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId, slug }),
    }) as Promise<{ deleted: boolean }>;
  }

  sync(scope: ArticlesScope, sourceDir: string) {
    return this.#request("/v2/articles/sync", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId, sourceDir }),
    }) as Promise<{ copied: number }>;
  }

  async getConfig(scope: ArticlesScope) {
    const url = new URL("/v2/articles/config", this.#location.origin);
    url.searchParams.set("sceneId", scope.sceneId);
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error(`articles failed (${response.status})`);
    return response.json() as Promise<ArticlesConfig>;
  }

  saveConfig(scope: ArticlesScope, config: SaveArticlesConfig) {
    return this.#request("/v2/articles/config", {
      method: "POST",
      body: JSON.stringify({
        sceneId: scope.sceneId,
        wechat: {
          appId: config.wechat.appId,
          appSecret: config.wechat.appSecret,
          siteUrl: config.wechat.siteUrl,
          author: config.wechat.author,
          thumbImagePath: config.wechat.thumbImagePath,
          openComment: config.wechat.openComment,
          fansCanComment: config.wechat.fansCanComment,
        },
        blog: {
          host: config.blog.host,
          username: config.blog.username,
          password: config.blog.password,
          remoteDir: config.blog.remoteDir,
          sourceDir: config.blog.sourceDir,
          resetHostKey: config.blog.resetHostKey === true,
        },
      }),
    }) as Promise<{ ok: boolean }>;
  }

  wechatSync(scope: ArticlesScope, slug: string, publish: boolean) {
    return this.#request("/v2/articles/wechat/sync", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId, slug, publish }),
    }) as Promise<{ mediaId: string; publishId: string | null }>;
  }

  wechatPublish(scope: ArticlesScope, slug: string) {
    return this.#request("/v2/articles/wechat/publish", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId, slug }),
    }) as Promise<{ publishId: string }>;
  }

  blogPublish(scope: ArticlesScope) {
    return this.#request("/v2/articles/blog/publish", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId }),
    }) as Promise<{ uploaded: number }>;
  }
}

export interface ArticlesState {
  articles: ArticleSummary[];
  current: Article | null;
  draftMarkdown: string;
  draftSlug: string;
  busy: boolean;
  error: string;
  notice: string;
  load(): Promise<void>;
  open(slug: string): Promise<void>;
  newArticle(): void;
  setMarkdown(markdown: string): void;
  setSlug(slug: string): void;
  save(silent?: boolean): Promise<void>;
  remove(slug: string): Promise<void>;
  syncFromSource(sourceDir: string): Promise<void>;
  syncWechat(publish: boolean): Promise<void>;
  publishWechat(): Promise<void>;
  publishBlog(): Promise<void>;
  clearError(): void;
}

export function createArticlesStore({
  gateway,
  getTarget,
  notify,
}: {
  gateway?: ArticlesGateway;
  getTarget: () => ArticlesScope;
  notify?: (message: { message: string; type?: string }) => void;
}) {
  const resolvedGateway = gateway ?? new ArticlesHttpGateway();
  return create<ArticlesState>((set, get) => {
    const fail = (error: unknown) => friendlyPluginError(error instanceof Error ? error : new Error(String(error)));
    let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
    const clearAutosave = () => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
    };
    const scheduleAutosave = () => {
      clearAutosave();
      if (!get().draftSlug.trim()) return;
      autosaveTimer = setTimeout(() => void get().save(true), AUTOSAVE_DELAY_MS);
    };
    return {
      articles: [],
      current: null,
      draftMarkdown: "",
      draftSlug: "",
      busy: false,
      error: "",
      notice: "",
      async load() {
        set({ busy: true, error: "" });
        try {
          const { articles } = await resolvedGateway.list(getTarget());
          set({ articles, busy: false });
        } catch (error) {
          set({ busy: false, error: fail(error) });
        }
      },
      async open(slug) {
        clearAutosave();
        set({ busy: true, error: "" });
        try {
          const article = await resolvedGateway.read(getTarget(), slug);
          set({ current: article, draftMarkdown: article.markdown, draftSlug: article.slug, busy: false });
        } catch (error) {
          set({ busy: false, error: fail(error) });
        }
      },
      newArticle() {
        clearAutosave();
        const markdown = "---\ntitle: \"\"\ndescription: \"\"\npubDate: \"\"\nslug: \"\"\ndraft: false\ntags: []\n---\n\n";
        set({ current: null, draftMarkdown: markdown, draftSlug: "", error: "" });
      },
      setMarkdown(markdown) {
        set({ draftMarkdown: markdown });
        scheduleAutosave();
      },
      setSlug(slug) {
        set({ draftSlug: slug });
        scheduleAutosave();
      },
      async save(silent = false) {
        clearAutosave();
        const { draftSlug, draftMarkdown } = get();
        if (!draftSlug.trim()) {
          if (!silent) set({ error: t("Article slug is required.") });
          return;
        }
        if (!silent) set({ busy: true, error: "" });
        try {
          await resolvedGateway.save(getTarget(), draftSlug.trim(), draftMarkdown);
          if (!silent) {
            notify?.({ message: t("Article saved"), type: "success" });
            await get().load();
            set({ busy: false });
          }
        } catch (error) {
          set({ busy: false, error: fail(error) });
        }
      },
      async remove(slug) {
        clearAutosave();
        set({ busy: true, error: "" });
        try {
          await resolvedGateway.delete(getTarget(), slug);
          notify?.({ message: t("Article deleted"), type: "success" });
          set({ current: null, draftMarkdown: "", draftSlug: "" });
          await get().load();
          set({ busy: false });
        } catch (error) {
          set({ busy: false, error: fail(error) });
        }
      },
      async syncFromSource(sourceDir) {
        set({ busy: true, error: "" });
        try {
          const { copied } = await resolvedGateway.sync(getTarget(), sourceDir);
          notify?.({ message: t("Synced {count} articles").replace("{count}", String(copied)), type: "success" });
          await get().load();
          set({ busy: false });
        } catch (error) {
          set({ busy: false, error: fail(error) });
        }
      },
      async syncWechat(publish) {
        const { draftSlug } = get();
        if (!draftSlug.trim()) {
          set({ error: t("Article slug is required.") });
          return;
        }
        set({ busy: true, error: "" });
        try {
          const result = await resolvedGateway.wechatSync(getTarget(), draftSlug.trim(), publish);
          notify?.({
            message: publish ? t("Published to WeChat") : t("Synced to WeChat draft"),
            type: "success",
          });
          set({ busy: false, notice: result.mediaId ? `mediaId: ${result.mediaId}` : "" });
          await get().load();
        } catch (error) {
          set({ busy: false, error: fail(error) });
        }
      },
      async publishWechat() {
        const { draftSlug } = get();
        if (!draftSlug.trim()) {
          set({ error: t("Article slug is required.") });
          return;
        }
        set({ busy: true, error: "" });
        try {
          await resolvedGateway.wechatPublish(getTarget(), draftSlug.trim());
          notify?.({ message: t("WeChat publish submitted"), type: "success" });
          set({ busy: false });
        } catch (error) {
          set({ busy: false, error: fail(error) });
        }
      },
      async publishBlog() {
        set({ busy: true, error: "" });
        try {
          const { uploaded } = await resolvedGateway.blogPublish(getTarget());
          notify?.({
            message: t("Published {count} files to blog").replace("{count}", String(uploaded)),
            type: "success",
          });
          set({ busy: false });
        } catch (error) {
          set({ busy: false, error: fail(error) });
        }
      },
      clearError() {
        set({ error: "" });
      },
    };
  });
}

export type ArticlesStore = ReturnType<typeof createArticlesStore>;
