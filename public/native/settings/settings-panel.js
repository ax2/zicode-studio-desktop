// React migration bridge: the settings panel now renders through the React
// implementation built into public/native/react/settings.js (see frontend/).
// The vanilla sub-panels (configuration, remote access, package browse, cost
// dashboard, toggles, thinking effort, scene profiles) are kept as-is and
// wired by the React factory after the panel DOM is mounted.
import { setupSettingsPanel as setupReactSettingsPanel } from "../react/settings.js";

export function setupSettingsPanel(options = {}) {
  return setupReactSettingsPanel(options);
}
