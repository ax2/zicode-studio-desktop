// Thin bridge: the scene indicator now lives in the React bundle
// (frontend/src/features/sceneIndicator). Re-export keeps the module's
// public surface stable for app.js and legacy tests.
export { setupSceneIndicator } from "../react/scene-indicator.js";
