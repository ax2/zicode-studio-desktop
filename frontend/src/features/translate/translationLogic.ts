// Shared helpers for the Translation feature.

export const TARGET_LANGUAGES = [
  "English",
  "Chinese",
  "Japanese",
  "Korean",
  "French",
  "German",
  "Spanish",
  "Russian",
  "Portuguese",
  "Arabic",
];

export interface TranslationResult {
  provider?: string;
  translated: string;
  model: string;
  targetLang: string;
  sourceLang?: string;
  charCount: number;
}
