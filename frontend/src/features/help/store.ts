import { create } from "zustand";
// @ts-expect-error plain JS module without type declarations
import { renderMarkdown } from "../../../../public/ui/markdown.js";
import {
  HELP_DEFAULT_PAGE,
  helpLocale,
  type HelpManifest,
  type HelpPage,
} from "./logic";

export interface HelpCenterOptions {
  fetchImpl?: typeof fetch;
  getLocaleImpl?: () => string;
  translateImpl?: (source: string) => string;
}

export interface HelpArticle {
  html: string;
  markdown: string;
  page: HelpPage;
}

interface HelpState {
  manifest: HelpManifest | null;
  manifestLocale: string;
  activePage: string;
  searchQuery: string;
  article: HelpArticle | null;
  error: string | null;
  setSearch(query: string): void;
  loadManifest(): Promise<HelpManifest>;
  loadPage(pageId: string): Promise<HelpPage>;
  invalidateLocale(): void;
}

export function createHelpStore(options: HelpCenterOptions) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const getLocaleImpl = options.getLocaleImpl ?? (() => "zh-CN");
  const translate = options.translateImpl ?? ((source: string) => source);

  return create<HelpState>()((set, get) => ({
    manifest: null,
    manifestLocale: helpLocale(getLocaleImpl()),
    activePage: HELP_DEFAULT_PAGE,
    searchQuery: "",
    article: null,
    error: null,

    setSearch(searchQuery) {
      set({ searchQuery });
    },

    async loadManifest() {
      const locale = helpLocale(getLocaleImpl());
      const current = get();
      if (current.manifest && current.manifestLocale === locale) return current.manifest;
      const response = await fetchImpl(
        locale === "en" ? "/help/en/manifest.json" : "/help/manifest.json",
      );
      if (!response.ok) {
        throw new Error(`${translate("Help index could not be loaded")} (${response.status})`);
      }
      const payload = (await response.json()) as HelpManifest;
      if (!Array.isArray(payload?.pages) || payload.pages.length === 0) {
        throw new Error(translate("Help index does not contain any pages"));
      }
      set({ manifest: payload, manifestLocale: locale });
      return payload;
    },

    async loadPage(pageId) {
      const manifest = await get().loadManifest();
      const page = manifest.pages.find((entry) => entry.id === pageId) || manifest.pages[0];
      set({ activePage: page.id, error: null });
      const prefix = get().manifestLocale === "en" ? "/help/en/" : "/help/";
      const response = await fetchImpl(`${prefix}${page.file}`);
      if (!response.ok) {
        throw new Error(`${translate("Help page could not be loaded")} (${response.status})`);
      }
      const markdown = await response.text();
      set({
        article: { html: renderMarkdown(markdown), markdown, page },
      });
      return page;
    },

    invalidateLocale() {
      set({ manifest: null });
      const activePage = get().activePage;
      void get()
        .loadPage(activePage)
        .catch((reason) => {
          set({ error: reason instanceof Error ? reason.message : String(reason) });
        });
    },
  }));
}
