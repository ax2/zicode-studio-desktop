// React migration bridge: the automation plugin now renders through the React
// implementation built into public/native/react/automation.js (see frontend/).
// Pure schedule logic is re-exported so existing callers keep working.
import {
  setupAutomationApp,
  nextAutomationRun,
  isAutomationDue,
} from "../react/automation.js";

export { setupAutomationApp, nextAutomationRun, isAutomationDue };
