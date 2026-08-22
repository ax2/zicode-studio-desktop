import { useRef, useState } from "react";
import type { Root } from "react-dom/client";
import { mountPluginSurface } from "../../shared/reactMount.js";
import { t } from "../../shared/i18n";
import { FirstRunGuide } from "../../shared/FirstRunGuide";
// @ts-expect-error plain JS module without type declarations (public/ui/markdown.js)
import { renderMarkdown } from "../../../../public/ui/markdown.js";
import {
  insertMarkdownLinePrefix,
  insertMarkdownLink,
  insertMarkdownTable,
  wrapMarkdownCodeBlock,
  wrapMarkdownSelection,
  type MarkdownEdit,
} from "../../shared/markdownFormatting";
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
  setTarget(): Promise<void>;
}

function ArticlesNav({ store }: { store: ArticlesStore }) {
  const articles = store((state) => state.articles);
  const current = store((state) => state.current);
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? articles.filter((article) => {
        const haystack = [
          article.title,
          article.slug,
          article.category ?? "",
          ...article.tags,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalized);
      })
    : articles;
  return (
    <nav className="articles-nav" aria-label={t("Articles")}>
      <button
        type="button"
        className="ui-button ui-button--primary ui-button--sm articles-nav-new"
        onClick={() => store.getState().newArticle()}
      >
        {t("New article")}
      </button>
      <input
        className="ui-input articles-search"
        type="search"
        value={query}
        placeholder={t("Search articles")}
        aria-label={t("Search articles")}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="articles-list">
        {filtered.length === 0 ? (
          <li className="articles-empty">{t("No articles yet")}</li>
        ) : (
          filtered.map((article) => (
            <li key={article.slug}>
              <button
                type="button"
                className={`articles-item${current?.slug === article.slug ? " active" : ""}`}
                onClick={() => void store.getState().open(article.slug)}
              >
                <span className="articles-item-title">{article.title || article.slug}</span>
                {article.wechatPublishId ? (
                  <span className="articles-item-badge articles-item-badge--published">
                    {t("Published")}
                  </span>
                ) : article.wechatDraftMediaId ? (
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
  const [preview, setPreview] = useState(false);
  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  const applyMarkdownEdit = (edit: MarkdownEdit) => {
    store.getState().setMarkdown(edit.next);
    window.requestAnimationFrame(() => {
      const el = contentRef.current;
      if (!el) return;
      el.focus();
      const selection = edit.selection ?? { start: edit.cursor, end: edit.cursor };
      el.setSelectionRange(selection.start, selection.end);
    });
  };

  const wrapSelection = (wrapper: string) => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      wrapMarkdownSelection(
        draftMarkdown,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
        wrapper,
      ),
    );
  };

  const wrapCodeBlock = () => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      wrapMarkdownCodeBlock(
        draftMarkdown,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      ),
    );
  };

  const insertPrefix = (prefix: string) => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      insertMarkdownLinePrefix(draftMarkdown, textarea.selectionStart ?? 0, prefix),
    );
  };

  const insertTable = () => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      insertMarkdownTable(
        draftMarkdown,
        textarea.selectionStart ?? 0,
        [t("Column 1"), t("Column 2")],
      ),
    );
  };

  const insertLinkMarkdown = () => {
    const textarea = contentRef.current;
    if (!textarea) return;
    applyMarkdownEdit(
      insertMarkdownLink(
        draftMarkdown,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      ),
    );
  };

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

      <FirstRunGuide
        storageKey="articles"
        title={t("Write, publish, sync")}
        steps={[
          t("Write a Markdown article and save it."),
          t("Sync it to a WeChat Official Account draft or publish directly."),
          t("Publish to the Astro blog or sync existing posts from the source directory."),
        ]}
        ctaLabel={t("New article")}
        onCta={() => store.getState().newArticle()}
      />

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
        <div className="articles-editor-toolbar">
          <button
            type="button"
            className={`ui-button ui-button--ghost ui-button--sm${preview ? "" : " active"}`}
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            {t("Edit")}
          </button>
          <button
            type="button"
            className={`ui-button ui-button--ghost ui-button--sm${preview ? " active" : ""}`}
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            {t("Preview")}
          </button>
        </div>
        {preview ? (
          <div
            className="markdown-body articles-preview"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown escapes HTML before returning the preview
            dangerouslySetInnerHTML={{ __html: renderMarkdown(draftMarkdown) }}
          />
        ) : (
          <>
            <div className="articles-format-bar" role="toolbar" aria-label={t("Markdown formatting")}>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Bold (Ctrl+B)")}
                aria-label={t("Bold (Ctrl+B)")}
                onClick={() => wrapSelection("**")}
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Italic (Ctrl+I)")}
                aria-label={t("Italic (Ctrl+I)")}
                onClick={() => wrapSelection("*")}
              >
                <em>I</em>
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Heading")}
                aria-label={t("Heading")}
                onClick={() => insertPrefix("## ")}
              >
                H
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Inline code")}
                aria-label={t("Inline code")}
                onClick={() => wrapSelection("`")}
              >
                {"<>"}
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Code block (Ctrl+Shift+K)")}
                aria-label={t("Code block (Ctrl+Shift+K)")}
                onClick={wrapCodeBlock}
              >
                {"{ }"}
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Quote")}
                aria-label={t("Quote")}
                onClick={() => insertPrefix("> ")}
              >
                ❝
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Bullet list")}
                aria-label={t("Bullet list")}
                onClick={() => insertPrefix("- ")}
              >
                ••
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Task list")}
                aria-label={t("Task list")}
                onClick={() => insertPrefix("- [ ] ")}
              >
                ☑
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Table")}
                aria-label={t("Table")}
                onClick={insertTable}
              >
                ▦
              </button>
              <button
                type="button"
                className="articles-format-btn"
                title={t("Link")}
                aria-label={t("Link")}
                onClick={insertLinkMarkdown}
              >
                🔗
              </button>
            </div>
            <textarea
              ref={contentRef}
              className="articles-textarea"
              value={draftMarkdown}
              aria-label={t("Markdown content")}
              rows={20}
              onChange={(event) => store.getState().setMarkdown(event.target.value)}
            />
          </>
        )}
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
          onClick={() => {
            if (current) void store.getState().remove(current.slug);
          }}
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
    setTarget() {
      return store.getState().load();
    },
  };
}
