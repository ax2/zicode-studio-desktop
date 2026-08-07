// React migration bridge: the project workspace now renders through the React
// implementation built into public/native/react/projects.js (see frontend/).
import {
  setupProjectWorkspaceApp,
  projectWorkspaceKey,
  readProjectWorkspaceProfile,
} from "../react/projects.js";

export { setupProjectWorkspaceApp, projectWorkspaceKey, readProjectWorkspaceProfile };
