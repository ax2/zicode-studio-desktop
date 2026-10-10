import { createProjectWorkspaceApp } from "./ProjectWorkspaceApp";
import type { ProjectWorkspaceOptions } from "./store";

export {
  defaultProjectProfile,
  projectName,
  projectWorkspaceKey,
  readProjectWorkspaceProfile,
  searchable,
} from "./logic";
export { createProjectWorkspaceApp } from "./ProjectWorkspaceApp";
export type { ProjectWorkspaceOptions } from "./store";

// Keep the vanilla shell's setupProjectWorkspaceApp contract.
export function setupProjectWorkspaceApp(options: ProjectWorkspaceOptions) {
  return createProjectWorkspaceApp(options);
}
