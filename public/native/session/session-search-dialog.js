// Thin bridge: the session search dialog now lives in the React bundle
// (frontend/src/features/sessionSearchDialog). Re-export keeps the module's
// public surface stable for app.js and legacy imports.
export { setupSessionSearchDialog } from "../react/session-search-dialog.js";
