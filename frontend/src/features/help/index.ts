import { createHelpCenterApp } from "./HelpCenterApp";
import type { HelpCenterOptions } from "./store";

export { createHelpCenterApp } from "./HelpCenterApp";
export { matchesSearch, readingMinutes, sectionIcon, slugify } from "./logic";
export type { HelpCenterOptions } from "./store";

// Keep the vanilla shell's setupHelpCenter contract.
export function setupHelpCenter(options: HelpCenterOptions = {}) {
  return createHelpCenterApp(options);
}
