import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  HELP_DEFAULT_PAGE,
  matchesSearch,
  readingMinutes,
  sectionIcon,
  slugify,
  type HelpManifest,
  type HelpPage,
} from "./logic";
import { createHelpStore, type HelpCenterOptions } from "./store";

type HelpStore = ReturnType<typeof createHelpStore>;

export function HelpNav({ store }: { store: HelpStore }) {
  const manifest = store((state) => state.manifest);
  const manifestLocale = store((state) => state.manifestLocale);
  const activePage = store((state) => state.activePage);
  const searchQuery = store((state) => state.searchQuery);
  const setSearch = store((state) => state.setSearch);
  const loadPage = store((state) => state.loadPage);
  const isEn = manifestLocale === "en";

  const sections = manifest?.sections ?? [];
  const uncategorized =
    manifest?.pages.filter((entry) => !entry.section && matchesSearch(entry, searchQuery)) ?? [];
  const matchCount = manifest?.pages.filter((entry) => matchesSearch(entry, searchQuery)).length ?? 0;

  return (
    <div className="help-center-navigation">
      <div className="help-center-nav-header">
        <span className="help-center-nav-eyebrow">
          {isEn ? "DOCUMENTATION" : "使用文档"}
        </span>
        <strong>{isEn ? "ZiCode Guide" : "ZiCode 指南"}</strong>
        <span className="help-center-nav-count">
          {isEn
            ? `${manifest?.pages.length ?? 0} articles`
            : `${manifest?.pages.length ?? 0} 篇文章`}
        </span>
      </div>
      <label className="help-center-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={searchQuery}
          placeholder={isEn ? "Filter documentation" : "筛选帮助内容"}
          aria-label={isEn ? "Filter documentation" : "筛选帮助内容"}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="help-center-tree">
        {sections.map((section) => {
          const pages = (manifest?.pages ?? []).filter(
            (entry) => entry.section === section && matchesSearch(entry, searchQuery),
          );
          if (pages.length === 0) return null;
          return (
            <details
              key={section}
              className="help-center-tree-branch"
              open={Boolean(searchQuery) || pages.some((page) => page.id === activePage)}
            >
              <summary className="help-center-nav-section">
                <span className="help-center-tree-icon" aria-hidden="true">
                  {sectionIcon(section)}
                </span>
                <span>{section}</span>
              </summary>
              <div className="help-center-tree-children">
                {pages.map((page) => (
                  <NavLink
                    key={page.id}
                    page={page}
                    activePage={activePage}
                    onSelect={(id) => void loadPage(id)}
                  />
                ))}
              </div>
            </details>
          );
        })}
        {uncategorized.map((page) => (
          <NavLink
            key={page.id}
            page={page}
            activePage={activePage}
            onSelect={(id) => void loadPage(id)}
          />
        ))}
        {matchCount === 0 ? (
          <div className="help-center-search-empty">
            {isEn ? "No matching documentation" : "没有匹配的帮助内容"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NavLink({
  page,
  activePage,
  onSelect,
}: {
  page: HelpPage;
  activePage: string;
  onSelect(id: string): void;
}) {
  return (
    <button
      type="button"
      className={`help-center-nav-link${page.id === activePage ? " active" : ""}`}
      data-help-page={page.id}
      onClick={() => onSelect(page.id)}
    >
      {page.title}
    </button>
  );
}

export function HelpMain({ store }: { store: HelpStore }) {
  const article = store((state) => state.article);
  const manifest = store((state) => state.manifest);
  const manifestLocale = store((state) => state.manifestLocale);
  const error = store((state) => state.error);
  const loadPage = store((state) => state.loadPage);
  const invalidateLocale = store((state) => state.invalidateLocale);
  const containerRef = useRef<HTMLDivElement>(null);
  const [toc, setToc] = useState<Array<{ id: string; level: string; text: string }>>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !article) return;
    container.innerHTML = article.html;
    decorateArticle(container, article.page, article.markdown, manifest, manifestLocale, loadPage);
    setToc(
      [...container.querySelectorAll("h2, h3")].map((heading) => ({
        id: heading.id,
        level: heading.tagName.toLowerCase(),
        text: heading.textContent ?? "",
      })),
    );
  }, [article, manifest, manifestLocale, loadPage]);

  useEffect(() => {
    const handler = () => invalidateLocale();
    window.addEventListener("zicode:locale-changed", handler);
    return () => window.removeEventListener("zicode:locale-changed", handler);
  }, [invalidateLocale]);

  return (
    <div className="help-center-layout help-center-layout--embedded">
      <article
        ref={containerRef}
        className="help-center-article"
        aria-busy={!article}
      >
        {!article && !error ? <p>Loading documentation…</p> : null}
        {error ? <p>{error}</p> : null}
      </article>
      <div className="help-center-toc">
        <div className="help-center-toc-title">
          {manifestLocale === "en" ? "On this page" : "本页目录"}
        </div>
        {toc.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`help-center-toc-link level-${item.level}`}
            onClick={() => {
              document.getElementById(item.id)?.scrollIntoView({
                block: "start",
                behavior: "smooth",
              });
            }}
          >
            {item.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function decorateArticle(
  container: HTMLElement,
  page: HelpPage,
  markdown: string,
  manifest: HelpManifest | null,
  manifestLocale: string,
  loadPage: (id: string) => Promise<unknown>,
) {
  const isEn = manifestLocale === "en";
  const firstHeading = container.querySelector("h1");
  if (firstHeading) {
    const hero = document.createElement("header");
    hero.className = "help-center-hero";
    const meta = document.createElement("div");
    meta.className = "help-center-hero-meta";
    const section = document.createElement("span");
    section.textContent = page.section || (isEn ? "Help" : "帮助");
    const readingTime = document.createElement("span");
    const minutes = readingMinutes(markdown);
    readingTime.textContent = isEn ? `${minutes} min read` : `约 ${minutes} 分钟`;
    meta.append(section, readingTime);
    firstHeading.before(hero);
    hero.append(meta, firstHeading);
    const lead = hero.nextElementSibling;
    if (lead?.tagName === "P") {
      lead.classList.add("help-center-lead");
      hero.append(lead);
    }
  }

  const usedIds = new Set<string>();
  for (const heading of container.querySelectorAll("h2, h3")) {
    const base = slugify(heading.textContent ?? "") || "section";
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    heading.id = id;
  }

  const index = (manifest?.pages ?? []).findIndex((entry) => entry.id === page.id);
  const previous = manifest?.pages?.[index - 1];
  const next = manifest?.pages?.[index + 1];
  if (previous || next) container.append(buildPager(previous, next, isEn, loadPage));

  for (const link of container.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") || "";
    if (!href.endsWith(".md")) continue;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const file = href.split("/").pop();
      const target = manifest?.pages.find((entry) => entry.file === file);
      if (target) void loadPage(target.id);
    });
  }
}

function buildPager(
  previous: HelpPage | undefined,
  next: HelpPage | undefined,
  isEn: boolean,
  loadPage: (id: string) => Promise<unknown>,
): HTMLElement {
  const pager = document.createElement("nav");
  pager.className = "help-center-pager";
  pager.setAttribute("aria-label", isEn ? "Documentation pages" : "帮助页面");
  for (const [page, direction] of [
    [previous, "previous"],
    [next, "next"],
  ] as Array<[HelpPage | undefined, "previous" | "next"]>) {
    if (!page) {
      pager.append(document.createElement("span"));
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `help-center-pager-link help-center-pager-link--${direction}`;
    const label = document.createElement("small");
    label.textContent =
      direction === "previous"
        ? isEn
          ? "Previous"
          : "上一篇"
        : isEn
          ? "Next"
          : "下一篇";
    const pageTitle = document.createElement("strong");
    pageTitle.textContent = `${direction === "previous" ? "←" : ""} ${page.title} ${
      direction === "next" ? "→" : ""
    }`.trim();
    button.append(label, pageTitle);
    button.addEventListener("click", () => void loadPage(page.id));
    pager.append(button);
  }
  return pager;
}

export interface HelpCenterAppApi {
  open(pageId?: string): Promise<void>;
  close(): void;
  loadPage(pageId: string): Promise<HelpPage>;
  setOpenHandler(handler: ((pageId: string | null) => void) | null): void;
  renderNavigation(container: HTMLElement): void;
  renderContent(container: HTMLElement): void;
}

export function createHelpCenterApp(options: HelpCenterOptions): HelpCenterAppApi {
  const store = createHelpStore(options);
  let openHandler: ((pageId: string | null) => void) | null = null;
  let navRoot: Root | null = null;
  let navWrapper: HTMLElement | null = null;
  let contentRoot: Root | null = null;
  let contentWrapper: HTMLElement | null = null;
  return {
    setOpenHandler(handler) {
      openHandler = typeof handler === "function" ? handler : null;
    },
    async open(pageId) {
      if (openHandler) openHandler(pageId ?? store.getState().activePage);
      await store
        .getState()
        .loadPage(pageId ?? store.getState().activePage)
        .catch((reason) => {
          store.setState({
            error: reason instanceof Error ? reason.message : String(reason),
          });
        });
    },
    close() {
      if (openHandler) openHandler(null);
    },
    loadPage(pageId) {
      return store.getState().loadPage(pageId);
    },
    renderNavigation(container) {
      if (!container) return;
      let root = navRoot;
      if (!root || !navWrapper || !container.contains(navWrapper)) {
        navWrapper = document.createElement("div");
        navWrapper.dataset.helpCenterNav = "";
        container.append(navWrapper);
        root = createRoot(navWrapper);
        navRoot = root;
      }
      root.render(<HelpNav store={store} />);
      void store.getState().loadManifest().catch((reason) => {
        store.setState({ error: reason instanceof Error ? reason.message : String(reason) });
      });
    },
    renderContent(container) {
      if (!container) return;
      let root = contentRoot;
      if (!root || !contentWrapper || !container.contains(contentWrapper)) {
        contentWrapper = document.createElement("div");
        contentWrapper.dataset.helpCenterRoot = "";
        container.append(contentWrapper);
        root = createRoot(contentWrapper);
        contentRoot = root;
      }
      root.render(<HelpMain store={store} />);
      if (!store.getState().article) {
        void store
          .getState()
          .loadPage(store.getState().activePage || HELP_DEFAULT_PAGE)
          .catch((reason) => {
            store.setState({
              error: reason instanceof Error ? reason.message : String(reason),
            });
          });
      }
    },
  };
}
