// Re-export the app's existing i18n so React modules share one locale pipeline
// instead of introducing a second translation system.
//
// The "i18n" bare specifier resolves through the index.html import map to the
// same /i18n.js module the native app uses, so every React bundle shares ONE
// locale instance (a bundled copy would freeze each bundle to its own locale
// state and fight the native MutationObserver during runtime switches).
export { getLocale, setLocale, t } from "i18n";
