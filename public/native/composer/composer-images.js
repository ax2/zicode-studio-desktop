// Thin bridge: image attachment logic now lives in the React composer bundle
// (frontend/src/features/composer). Re-exports keep the module's public
// surface stable for app.js and legacy imports.
export {
  defaultProcessImageFile,
  setupComposerImageAttachments,
} from "../react/composer.js";
