// Thin bridge: the mobile image picker now lives in the React composer bundle
// (frontend/src/features/composer). Re-export keeps the module's public
// surface stable for legacy imports and tests.
export { setupComposerImagePicker } from "../react/composer.js";
