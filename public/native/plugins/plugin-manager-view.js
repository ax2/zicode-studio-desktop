// Thin bridge: the plugin manager view now lives in the React bundle
// (frontend/src/features/pluginManagerView). Re-export keeps the module's
// public surface stable for plugin-shell and legacy tests.
export { renderPluginManagerView } from "../react/plugin-manager-view.js";
