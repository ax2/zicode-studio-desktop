// Thin bridge: the native file browser now lives in the React bundle
// (frontend/src/features/fileBrowser). Re-export keeps the module's public
// surface stable for app.js and legacy tests.
export { NativeFileBrowser } from "../react/file-browser.js";
