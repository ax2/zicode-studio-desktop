import { useState } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import {
  createArticlesStore,
  type ArticlesGateway,
  type ArticlesScope,
  type ArticlesStore,
} from "./articlesStore";

export interface ArticlesOptions {
  gateway?: ArticlesGateway;
  getTarget: () => ArticlesScope;
  notify?: (message: { message: string; type?: string }) => void;
  openSettings?: (section?: string) => void;
}

export interface ArticlesAppApi {
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
  deactivate(): void;
  destroy(): void;
  handlesCommand(commandId: string): boolean;
  executeCommand(): void;
  refresh(): Promise<void>;
}

function ArticlesNav({ store }: { store: ArticlesStore }) {
  const articles = store((state) => state.articles);
  const current = store((state) => state.current);
  return (
    <nav className="articles-nav" aria-label={t("Articles")}>
      <button
        type="button"
        className="ui-button ui-button--primary ui-button--sm articles-nav-new"
        onClick={() => store.getState().newArticle()}
      >
        {t("New article")}
      </button>
      <ul className="articles-list">
        {articles.length === 0 ? (
          <li className="articles-empty">{t("No articles yet")}</li>
        ) : (
          articles.map((article) => (
            <li key={article.slug}>
              <button
                type="button"
                className={`articles-item${current?.slug === article.slug ? " active" : ""}`}
                onClick={() => void store.getState().open(article.slug)}
              >
                <span className="articles-item-title">{article.title || article.slug}</span>
                {article.wechatDraftMediaId ? (
                  <span className="articles-item-badge">{t("WeChat draft")}</span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </nav>
  );
}

function ArticlesMain({
  store,
  openSettings,
}: {
  store: ArticlesStore;
  openSettings?: (section?: string) => void;
}) {
  const current = store((state) => state.current);
  const draftMarkdown = store((state) => state.draftMarkdown);
  const draftSlug = store((state) => state.draftSlug);
  const busy = store((state) => state.busy);
  const error = store((state) => state.error);
  const notice = store((state) => state.notice);
  const [sourceDir, setSourceDir] = useState("");

  return (
    <div className="articles-main">
      <header className="articles-header">
        <div>
          <h1>{t("Articles")}</h1>
          <p>{t("Create and publish articles to the Astro blog and WeChat Official Account.")}</p>
        </div>
        <div className="articles-header-actions">
          <button
            type="button"
            className="ui-button ui-button--ghost ui-button--sm"
            onClick={() => openSettings?.("articles")}
          >
            {t("Publishing settings")}
          </button>
        </div>
      </header>

      <section className="ui-card articles-slug">
        <label className="articles-field">
          <span>{t("Slug")}</span>
          <input
            className="ui-input"
            value={draftSlug}
            aria-label={t("Slug")}
            onChange={(event) => store.getState().setSlug(event.target.value)}
          />
        </label>
      </section>

      <section className="ui-card articles-editor">
        <textarea
          className="articles-textarea"
          value={draftMarkdown}
          aria-label={t("Markdown content")}
          rows={20}
          onChange={(event) => store.getState().setMarkdown(event.target.value)}
        />
      </section>

      {error ? (
        <p className="articles-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="articles-notice">{notice}</p> : null}

      <section className="ui-card articles-actions">
        <button
          type="button"
          className="ui-button ui-button--primary ui-button--sm"
          disabled={busy || !draftSlug.trim()}
          aria-busy={busy}
          onClick={() => void store.getState().save()}
        >
          {t("Save")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm"
          disabled={busy || !current}
          onClick={() => void store.getState().remove(current!.slug)}
        >
          {t("Delete")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={busy || !draftSlug.trim()}
          onClick={() => void store.getState().syncWechat(false)}
        >
          {t("Sync to WeChat draft")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={busy || !draftSlug.trim()}
          onClick={() => void store.getState().syncWechat(true)}
        >
          {t("Sync and publish to WeChat")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm"
          disabled={busy || !current?.wechatDraftMediaId}
          onClick={() => void store.getState().publishWechat()}
        >
          {t("Publish existing WeChat draft")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={busy}
          onClick={() => void store.getState().publishBlog()}
        >
          {t("Publish to blog")}
        </button>
      </section>

      <section className="ui-card articles-sync">
        <label className="articles-field">
          <span>{t("Astro source directory")}</span>
          <input
            className="ui-input"
            value={sourceDir}
            placeholder="/home/alex/work/www.zicode.com/astro-site/src/content/blog"
            aria-label={t("Astro source directory")}
            onChange={(event) => setSourceDir(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="ui-button ui-button--secondary ui-button--sm"
          disabled={busy || !sourceDir.trim()}
          onClick={() => void store.getState().syncFromSource(sourceDir.trim())}
        >
          {t("Sync from source")}
        </button>
      </section>
    </div>
  );
}

export function createArticlesApp(options: ArticlesOptions): ArticlesAppApi {
  const store = createArticlesStore(options);
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  return {
    renderNavigation(container) {
      navRoot = mountPluginSurface(container, <ArticlesNav store={store} />, navRoot);
    },
    renderContent(container) {
      contentRoot = mountPluginSurface(
        container,
        <ArticlesMain store={store} openSettings={options.openSettings} />,
        contentRoot,
      );
    },
    deactivate() {},
    destroy() {
      navRoot?.unmount();
      contentRoot?.unmount();
      navRoot = null;
      contentRoot = null;
    },
    handlesCommand(commandId) {
      return commandId === "articles.open";
    },
    executeCommand() {},
    refresh() {
      return store.getState().load();
    },
  };
}
