// React migration bridge: the settings panel now renders through the React
// implementation built into public/native/react/settings.js (see frontend/).
// The vanilla sub-panels (configuration, remote access, package browse, cost
// dashboard, toggles, thinking effort, scene profiles) are kept as-is and
// wired by the React factory after the panel DOM is mounted.
import { setupSettingsPanel as setupReactSettingsPanel } from "../react/settings.js";
import { loadCostDashboard } from "./cost-dashboard.js";
import { setupPackageBrowse } from "./package-browse.js";
import { setupRemoteAccessSettings } from "./remote-access-settings.js";
import { setupSceneProfiles } from "./scene-profiles.js";
import { setupSettingsToggles } from "./settings-toggles.js";
import { setupThinkingEffortControl } from "./thinking-effort-control.js";

export function setupSettingsPanel(options = {}) {
  return setupReactSettingsPanel({
    ...options,
    modules: {
      setupRemoteAccessSettings,
      setupPackageBrowse,
      loadCostDashboard,
      setupSettingsToggles,
      setupThinkingEffortControl,
      setupSceneProfiles,
    },
  });
}
