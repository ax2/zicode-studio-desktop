// Thin bridge: the startup failure surface now lives in the React bundle
// (frontend/src/features/startupFailure). Re-export keeps the module's public
// surface stable for bootstrap-entry and legacy tests.
export { renderStartupFailure } from "../react/startup-failure.js";
