import { createArtifactApp } from "./ArtifactApp";
import type { ArtifactAppOptions } from "./store";

export { createArtifactApp } from "./ArtifactApp";
export type { ArtifactAppOptions } from "./store";
export {
  formatBytes,
  formatDate,
  formatDateTime,
  kindLabel,
  markdownContent,
  pluginLabel,
  safeFileName,
  stringifyContent,
} from "./logic";

// Keep the vanilla shell's setupArtifactApp contract.
export function setupArtifactApp(options: ArtifactAppOptions) {
  return createArtifactApp(options);
}
