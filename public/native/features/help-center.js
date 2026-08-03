import { getLocale } from "../../i18n.js";
import { renderMarkdown } from "../../ui/markdown.js";

const DEFAULT_PAGE = "getting-started";

export function setupHelpCenter({
  fetchImpl = window.fetch.bind(window),
  getLocaleImpl = getLocale,
} = {}) {
  const panel = document.getElementById("help-center");
  const overlay = document.getElementById("help-center-overlay");
  const closeButton = document.getElementById("help-center-close");
  const sidebar = document.getElementById("help-center-navigation");
  const article = document.getElementById("help-center-article");
  const tableOfContents = document.getElementById("help-center-toc");
  const title = document.getElementById("help-center-page-title");
  const openButtons = [document.getElementById("help-btn")].filter(Boolean);
  const homeButton = document.getElementById("help-center-home");
  const layout = panel?.querySelector(".help-center-layout");
  if (!panel || !layout || !article || !sidebar || !tableOfContents) return null;

  let manifest = null;
  let activePage = DEFAULT_PAGE;
  let previousFocus = null;
  let openHandler = null;
  let manifestLocale = null;
  let searchQuery = "";

  async function loadManifest() {
    const locale = getLocaleImpl() === "en" ? "en" : "zh-CN";
    if (manifest && manifestLocale === locale) return manifest;
    manifest = null;
    manifestLocale = locale;
    const response = await fetchImpl(
      locale === "en" ? "/help/en/manifest.json" : "/help/manifest.json",
    );
    if (!response.ok) throw new Error(`Help index could not be loaded (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload?.pages) || payload.pages.length === 0) {
      throw new Error("Help index does not contain any pages");
    }
    manifest = payload;
    renderNavigation();
    return manifest;
  }

  function renderNavigation() {
    sidebar.replaceChildren();
    const header = document.createElement("div");
    header.className = "help-center-nav-header";
    const eyebrow = document.createElement("span");
    eyebrow.className = "help-center-nav-eyebrow";
    eyebrow.textContent = manifestLocale === "en" ? "DOCUMENTATION" : "使用文档";
    const heading = document.createElement("strong");
    heading.textContent = manifestLocale === "en" ? "ZiCode Guide" : "ZiCode 指南";
    const count = document.createElement("span");
    count.className = "help-center-nav-count";
    count.textContent =
      manifestLocale === "en"
        ? `${manifest.pages.length} articles`
        : `${manifest.pages.length} 篇文章`;
    header.append(eyebrow, heading, count);

    const search = document.createElement("label");
    search.className = "help-center-search";
    const searchIcon = document.createElement("span");
    searchIcon.setAttribute("aria-hidden", "true");
    searchIcon.textContent = "⌕";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.value = searchQuery;
    searchInput.placeholder = manifestLocale === "en" ? "Filter documentation" : "筛选帮助内容";
    searchInput.setAttribute(
      "aria-label",
      manifestLocale === "en" ? "Filter documentation" : "筛选帮助内容",
    );
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value.trim().toLocaleLowerCase();
      renderNavigationTree(tree);
    });
    search.append(searchIcon, searchInput);
    const tree = document.createElement("div");
    tree.className = "help-center-tree";
    sidebar.append(header, search, tree);
    renderNavigationTree(tree);
  }

  function renderNavigationTree(tree) {
    tree.replaceChildren();
    let matchCount = 0;
    for (const section of manifest.sections || []) {
      const pages = manifest.pages.filter(
        (entry) => entry.section === section && matchesSearch(entry, searchQuery),
      );
      if (pages.length === 0) continue;
      matchCount += pages.length;
      const branch = document.createElement("details");
      branch.className = "help-center-tree-branch";
      branch.open = Boolean(searchQuery) || pages.some((page) => page.id === activePage);
      const heading = document.createElement("summary");
      heading.className = "help-center-nav-section";
      const icon = document.createElement("span");
      icon.className = "help-center-tree-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = sectionIcon(section);
      const label = document.createElement("span");
      label.textContent = section;
      heading.append(icon, label);
      const children = document.createElement("div");
      children.className = "help-center-tree-children";
      for (const page of pages) {
        children.append(buildNavigationButton(page));
      }
      branch.append(heading, children);
      tree.append(branch);
    }
    for (const page of manifest.pages.filter(
      (entry) => !entry.section && matchesSearch(entry, searchQuery),
    )) {
      matchCount += 1;
      tree.append(buildNavigationButton(page));
    }
    if (matchCount === 0) {
      const empty = document.createElement("div");
      empty.className = "help-center-search-empty";
      empty.textContent =
        manifestLocale === "en" ? "No matching documentation" : "没有匹配的帮助内容";
      tree.append(empty);
    }
  }

  function buildNavigationButton(page) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "help-center-nav-link";
    button.dataset.helpPage = page.id;
    button.textContent = page.title;
    button.classList.toggle("active", page.id === activePage);
    button.addEventListener("click", () => loadPage(page.id));
    return button;
  }

  async function loadPage(pageId) {
    const index = await loadManifest();
    const page = index.pages.find((entry) => entry.id === pageId) || index.pages[0];
    activePage = page.id;
    article.setAttribute("aria-busy", "true");
    article.textContent = "Loading documentation…";
    const prefix = manifestLocale === "en" ? "/help/en/" : "/help/";
    const response = await fetchImpl(`${prefix}${page.file}`);
    if (!response.ok) throw new Error(`Help page could not be loaded (${response.status})`);
    const markdown = await response.text();
    article.innerHTML = renderMarkdown(markdown);
    decorateArticle(page, markdown);
    article.setAttribute("aria-busy", "false");
    if (title) title.textContent = page.title;
    for (const button of sidebar.querySelectorAll("[data-help-page]")) {
      button.classList.toggle("active", button.dataset.helpPage === page.id);
      if (button.dataset.helpPage === page.id) button.closest("details")?.setAttribute("open", "");
    }
    buildTableOfContents();
    wireArticleLinks();
    article.scrollTop = 0;
  }

  function decorateArticle(page, markdown) {
    const firstHeading = article.querySelector("h1");
    if (firstHeading) {
      const hero = document.createElement("header");
      hero.className = "help-center-hero";
      const meta = document.createElement("div");
      meta.className = "help-center-hero-meta";
      const section = document.createElement("span");
      section.textContent = page.section || (manifestLocale === "en" ? "Help" : "帮助");
      const readingTime = document.createElement("span");
      const minutes = Math.max(1, Math.ceil(markdown.replace(/[#*`>|[\]()_-]/g, "").length / 700));
      readingTime.textContent =
        manifestLocale === "en" ? `${minutes} min read` : `约 ${minutes} 分钟`;
      meta.append(section, readingTime);
      firstHeading.before(hero);
      hero.append(meta, firstHeading);
      const lead = hero.nextElementSibling;
      if (lead?.tagName === "P") {
        lead.classList.add("help-center-lead");
        hero.append(lead);
      }
    }

    const index = manifest.pages.findIndex((entry) => entry.id === page.id);
    const previous = manifest.pages[index - 1];
    const next = manifest.pages[index + 1];
    if (previous || next) article.append(buildPager(previous, next));
  }

  function buildPager(previous, next) {
    const pager = document.createElement("nav");
    pager.className = "help-center-pager";
    pager.setAttribute("aria-label", manifestLocale === "en" ? "Documentation pages" : "帮助页面");
    for (const [page, direction] of [
      [previous, "previous"],
      [next, "next"],
    ]) {
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
          ? manifestLocale === "en"
            ? "Previous"
            : "上一篇"
          : manifestLocale === "en"
            ? "Next"
            : "下一篇";
      const pageTitle = document.createElement("strong");
      pageTitle.textContent = `${direction === "previous" ? "←" : ""} ${page.title} ${direction === "next" ? "→" : ""}`.trim();
      button.append(label, pageTitle);
      button.addEventListener("click", () => loadPage(page.id));
      pager.append(button);
    }
    return pager;
  }

  function buildTableOfContents() {
    tableOfContents.replaceChildren();
    const title = document.createElement("div");
    title.className = "help-center-toc-title";
    title.textContent = manifestLocale === "en" ? "On this page" : "本页目录";
    tableOfContents.append(title);
    const usedIds = new Set();
    for (const heading of article.querySelectorAll("h2, h3")) {
      const base = slugify(heading.textContent) || "section";
      let id = base;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      heading.id = id;
      const link = document.createElement("a");
      link.href = `#${id}`;
      link.className = `help-center-toc-link level-${heading.tagName.toLowerCase()}`;
      link.textContent = heading.textContent;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        heading.scrollIntoView({ block: "start", behavior: "smooth" });
      });
      tableOfContents.append(link);
    }
  }

  function wireArticleLinks() {
    for (const link of article.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") || "";
      if (!href.endsWith(".md")) continue;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const file = href.split("/").pop();
        const page = manifest.pages.find((entry) => entry.file === file);
        if (page) void loadPage(page.id);
      });
    }
  }

  async function open(pageId = activePage) {
    if (openHandler) {
      openHandler(pageId);
      try {
        await loadPage(pageId);
      } catch (error) {
        article.removeAttribute("aria-busy");
        article.textContent = error?.message || String(error);
      }
      return;
    }
    previousFocus = document.activeElement;
    panel.classList.remove("hidden");
    overlay?.classList.remove("hidden");
    try {
      await loadPage(pageId);
      closeButton?.focus();
    } catch (error) {
      article.removeAttribute("aria-busy");
      article.textContent = error?.message || String(error);
    }
  }

  function close() {
    if (openHandler) {
      openHandler(null);
      return;
    }
    panel.classList.add("hidden");
    overlay?.classList.add("hidden");
    previousFocus?.focus?.();
  }

  for (const button of openButtons) button.addEventListener("click", () => open());
  homeButton?.addEventListener("click", () => loadPage(DEFAULT_PAGE));
  closeButton?.addEventListener("click", close);
  overlay?.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.classList.contains("hidden")) close();
  });
  window.addEventListener("zicode:locale-changed", () => {
    manifest = null;
    if (article.isConnected) {
      void loadPage(activePage).catch((error) => {
        article.removeAttribute("aria-busy");
        article.textContent = error?.message || String(error);
      });
    }
  });

  return {
    open,
    close,
    loadPage,
    setOpenHandler(handler) {
      openHandler = typeof handler === "function" ? handler : null;
      if (!openHandler) return;
      panel.classList.add("hidden");
      overlay?.classList.add("hidden");
    },
    renderNavigation(container) {
      container.append(sidebar);
      void loadManifest().catch((error) => {
        sidebar.textContent = error?.message || String(error);
      });
    },
    renderContent(container) {
      panel.classList.add("hidden");
      overlay?.classList.add("hidden");
      layout.classList.add("help-center-layout--embedded");
      container.replaceChildren(layout);
      if (!article.textContent.trim()) {
        void loadPage(activePage).catch((error) => {
          article.removeAttribute("aria-busy");
          article.textContent = error?.message || String(error);
        });
      }
    },
  };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function sectionIcon(section) {
  const value = String(section || "").toLowerCase();
  if (
    value.includes("start") ||
    value.includes("guide") ||
    value.includes("开始") ||
    value.includes("指南")
  )
    return "✦";
  if (value.includes("scene") || value.includes("场景") || value.includes("config")) return "◫";
  if (value.includes("plugin") || value.includes("插件")) return "◇";
  if (value.includes("note") || value.includes("笔记")) return "▤";
  if (value.includes("finance") || value.includes("金融")) return "⌁";
  if (value.includes("artifact") || value.includes("产物")) return "⬡";
  if (value.includes("workflow") || value.includes("效率") || value.includes("工作流")) return "↯";
  if (value.includes("reference") || value.includes("参考") || value.includes("support")) return "?";
  return "•";
}

function matchesSearch(page, query) {
  if (!query) return true;
  return [page.title, page.section, page.summary, ...(page.keywords || [])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(query);
}
