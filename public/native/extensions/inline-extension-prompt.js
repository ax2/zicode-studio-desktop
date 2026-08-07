// Thin bridge: the inline extension prompt now lives in the React bundle
// (frontend/src/features/inlineExtensionPrompt). Re-exports keep the module's
// public surface stable for app.js and legacy tests.
export {
  isInlineAskUserQuestionRequest,
  showInlineExtensionPrompt,
} from "../react/inline-extension-prompt.js";
