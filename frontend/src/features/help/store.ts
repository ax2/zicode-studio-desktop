import { create } from "zustand";
// @ts-expect-error plain JS module without type declarations
import { renderMarkdown } from "../../../../public/ui/markdown.js";
import { HELP_DEFAULT_PAGE, type HelpManifest, type HelpPage, helpLocale } from "./logic";

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
  let localeEpoch = 0;
  let pageSequence = 0;

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
      const epoch = localeEpoch;
      const sequence = pageSequence;
      const current = get();
      if (current.manifest && current.manifestLocale === locale) return current.manifest;
      try {
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
        if (epoch === localeEpoch && locale === helpLocale(getLocaleImpl())) {
          set({ manifest: payload, manifestLocale: locale });
        }
        return payload;
      } catch (reason) {
        if (
          epoch === localeEpoch &&
          sequence === pageSequence &&
          locale === helpLocale(getLocaleImpl())
        ) {
          set({ error: reason instanceof Error ? reason.message : String(reason) });
        }
        throw reason;
      }
    },

    async loadPage(pageId) {
      const sequence = ++pageSequence;
      const epoch = localeEpoch;
      const locale = helpLocale(getLocaleImpl());
      const isCurrent = () =>
        sequence === pageSequence &&
        epoch === localeEpoch &&
        locale === helpLocale(getLocaleImpl());
      set({ activePage: pageId, article: null, error: null });
      try {
        const manifest = await get().loadManifest();
        const page = manifest.pages.find((entry) => entry.id === pageId) || manifest.pages[0];
        if (!isCurrent()) return page;
        set({ activePage: page.id, error: null });
        const prefix = locale === "en" ? "/help/en/" : "/help/";
        const response = await fetchImpl(`${prefix}${page.file}`);
        if (!response.ok) {
          throw new Error(`${translate("Help page could not be loaded")} (${response.status})`);
        }
        const markdown = await response.text();
        if (isCurrent())
          set({
            article: { html: renderMarkdown(markdown), markdown, page },
          });
        return page;
      } catch (reason) {
        if (isCurrent()) set({ error: reason instanceof Error ? reason.message : String(reason) });
        throw reason;
      }
    },

    invalidateLocale() {
      localeEpoch += 1;
      set({ manifest: null, article: null, manifestLocale: helpLocale(getLocaleImpl()) });
      const activePage = get().activePage;
      void get()
        .loadPage(activePage)
        .catch(() => {});
    },
  }));
}
