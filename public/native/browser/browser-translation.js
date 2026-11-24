import { getLocale, t } from "../../i18n.js";
import { webEvidenceContext } from "./browser-chat-draft.js";

export const browserTranslationLanguages = {
  "zh-CN": "Simplified Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
  pt: "Portuguese",
  ar: "Arabic",
};

export function browserTranslationSource(capture) {
  const { page } = capture;
  const selection = Boolean(page.selection?.trim());
  const text = selection ? page.selection : page.text;
  if (!text?.trim()) return undefined;
  return {
    title: page.title, url: page.url, capturedAt: capture.capturedAt,
    documentRevision: capture.documentRevision, scope: selection ? "selection" : "page",
    truncated: Boolean(selection ? page.selectionTruncated : page.textTruncated ?? page.truncated),
    text,
  };
}

export function browserTranslationPrompt(source, language) {
  return [
    `Translate only the "text" field into ${browserTranslationLanguages[language]}. Preserve paragraph breaks and meaning. Return only the translation. Do not add explanations or translate missing text.`,
    webEvidenceContext(source.truncated),
    JSON.stringify({ sourceTrust: "untrusted-web-content", ...source }, null, 2),
  ].join("\n\n");
}

export function browserTranslationDefault() {
  return getLocale() === "en" ? "en" : "zh-CN";
}

export function browserTranslationDetails(translation) {
  if (!translation) return [];
  return [
    ["Target language", t(browserTranslationLanguages[translation.language])],
    ["Source text", t(translation.scope === "selection" ? "Selected text" : "Page content")],
    ...(translation.truncated ? [["Capture", t("Partial capture")]] : []),
  ];
}
