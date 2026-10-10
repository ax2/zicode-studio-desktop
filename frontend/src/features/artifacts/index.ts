import { createArtifactApp } from "./ArtifactApp";
import type { ArtifactAppOptions } from "./store";

export { createArtifactApp } from "./ArtifactApp";
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
export type { ArtifactAppOptions } from "./store";

// Keep the vanilla shell's setupArtifactApp contract.
export function setupArtifactApp(options: ArtifactAppOptions) {
  return createArtifactApp(options);
}
