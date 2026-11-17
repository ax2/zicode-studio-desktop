import { t } from "../../i18n.js";

export function browserCitation(index) {
  return `[${index + 1}]`;
}

export function numberBrowserSources(sources) {
  const tabs = new Set();
  return sources.map((source, index) => {
    if (!source.tab || tabs.has(source.tab) || !/^https?:\/\//i.test(source.url ?? "") ||
        !["string", "number"].includes(typeof source.documentRevision)) {
      throw new Error(t("A selected tab changed. Reopen the page preview and try again."));
    }
    tabs.add(source.tab);
    return { ...source, citation: browserCitation(index) };
  });
}
