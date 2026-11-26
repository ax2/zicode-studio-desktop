import { zhCN } from "./locales/zh-CN/index.js";
import { createDomTranslator } from "./i18n-dom.js";

const LOCALE_COOKIE = "zicode-studio-locale";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;

export const supportedLocales = {
  "zh-CN": "简体中文",
  en: "English",
};

const dictionaries = { "zh-CN": zhCN, en: {} };
const domTranslator = createDomTranslator(
  (source) => dictionaries[activeLocale]?.[normalizeSource(source)] ?? source,
);
let activeLocale = readLocaleCookie();
let observer;

function readLocaleCookie() {
  try {
    const entry = document.cookie
      .split("; ")
      .find((value) => value.startsWith(`${LOCALE_COOKIE}=`));
    const locale = entry ? decodeURIComponent(entry.slice(LOCALE_COOKIE.length + 1)) : "";
    return supportedLocales[locale] ? locale : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

function writeLocaleCookie(locale) {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: synchronous cross-port preference storage
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  } catch {
    // Sandboxed WebViews may reject cookies.
  }
}

export function getLocale() {
  return activeLocale;
}

export function t(source, locale = readLocaleCookie()) {
  // A later-loaded feature or a sibling Studio window may have changed the shared preference.
  return dictionaries[locale]?.[normalizeSource(source)] ?? source;
}

function normalizeSource(source) {
  return String(source).trim().replace(/\s+/g, " ");
}

export function translateDocument(root = document.body) {
  if (!root) return;
  domTranslator.translateDocument(root);
  document.documentElement.lang = activeLocale;
}

export function setLocale(locale) {
  if (!supportedLocales[locale]) return;
  activeLocale = locale;
  writeLocaleCookie(locale);
  translateDocument();
  window.dispatchEvent(new CustomEvent("zicode:locale-changed", { detail: { locale } }));
}

export function initializeI18n() {
  translateDocument();
  observer?.disconnect();
  observer = new MutationObserver((records) => {
    observer.disconnect();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) translateDocument(node);
        else if (node.nodeType === Node.TEXT_NODE) domTranslator.translateTextNode(node);
      }
    }
    observer.observe(document.body, { childList: true, subtree: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
