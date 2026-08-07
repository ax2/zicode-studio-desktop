import { createHelpCenterApp } from "./HelpCenterApp";
import type { HelpCenterOptions } from "./store";

export { createHelpCenterApp } from "./HelpCenterApp";
export type { HelpCenterOptions } from "./store";
export { matchesSearch, readingMinutes, sectionIcon, slugify } from "./logic";

// Keep the vanilla shell's setupHelpCenter contract.
export function setupHelpCenter(options: HelpCenterOptions = {}) {
  return createHelpCenterApp(options);
}
