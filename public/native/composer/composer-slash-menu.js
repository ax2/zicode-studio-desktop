// Thin bridge: slash menu logic now lives in the React composer bundle
// (frontend/src/features/composer). Re-exports keep the module's public
// surface stable for app.js and legacy tests.
export {
  activeSlashQuery,
  setupComposerSlashMenu,
  titleCaseCommandName,
} from "../react/composer.js";
