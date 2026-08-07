import { createAutomationApp } from "./AutomationApp";
import type { AutomationAppOptions } from "./store";

export { nextAutomationRun, isAutomationDue } from "./logic";
export { createAutomationApp } from "./AutomationApp";
export type { AutomationAppOptions } from "./store";

// Keep the vanilla shell's setupAutomationApp contract: it receives the same
// options and returns the same app object shape (renderNavigation / renderContent).
export function setupAutomationApp(options: AutomationAppOptions) {
  return createAutomationApp(options);
}
