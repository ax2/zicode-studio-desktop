// Thin bridge: the command palette now lives in the React bundle
// (frontend/src/features/commandPalette). Re-export keeps the module's
// public surface stable for app.js and legacy tests.
export { setupCommandPalette } from "../react/command-palette.js";
