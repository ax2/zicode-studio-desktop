// Thin bridge: the header "open in app" control now lives in the React bundle
// (frontend/src/features/headerOpenApp). Re-export keeps the module's public
// surface stable for app.js and legacy tests.
export { setupHeaderOpenApp } from "../react/header-open-app.js";
