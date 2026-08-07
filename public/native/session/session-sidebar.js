// Thin bridge: the session sidebar now lives in the React bundle
// (frontend/src/features/sessionSidebar). Re-exports keep the module's public
// surface stable for app.js and legacy tests.
export { formatSessionTime, SessionSidebar } from "../react/session-sidebar.js";
