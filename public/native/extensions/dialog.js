// Thin bridge: the native extension dialog now lives in the React bundle
// (frontend/src/features/dialog). Re-exports keep the module's public surface
// stable for app.js and legacy tests.
export {
  parseDialogContent,
  parseOption,
  showNativeDialog,
} from "../react/dialog.js";
