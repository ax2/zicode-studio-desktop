// Thin bridge: the Pi task-progress mirror panel now lives in the React bundle
// (frontend/src/features/rpivTodoMirror). Re-exports keep the module's public
// surface stable for app.js and legacy tests.
export {
  isRpivTodoCommandNotify,
  isRpivTodoDetails,
  isRpivTodoWidgetRequest,
  replayRpivTodoFromMessages,
  RpivTodoMirrorPanel,
} from "../react/rpiv-todo-mirror.js";
