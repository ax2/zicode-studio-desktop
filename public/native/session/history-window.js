// Thin bridge: the history window now lives in the React bundle
// (frontend/src/features/historyWindow). Re-export keeps the module's
// public surface stable for app.js and legacy tests.
export {
  createHistoryWindow,
  createHistoryWindowNotice,
  createHistoryLoadedStatus,
  DEFAULT_HISTORY_BATCH_SIZE,
} from "../react/history-window.js";
