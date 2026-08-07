// Re-export the app's existing i18n so React modules share one locale pipeline
// instead of introducing a second translation system.
// @ts-expect-error plain JS module without type declarations (public/i18n.js)
export { t, getLocale, setLocale } from "../../../public/i18n.js";
