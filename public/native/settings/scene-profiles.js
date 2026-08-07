// Compatibility shim: scene profile helpers now live in the React settings
// bundle (frontend/src/features/settings/sceneProfiles.ts). Vanilla consumers
// (workspace-actions, scene-indicator) re-export from the shared bundle.
export {
  fallbackSceneProfiles,
  getSelectedSceneId,
  normalizeSceneId,
  persistSelectedScene,
} from "../react/settings.js";
