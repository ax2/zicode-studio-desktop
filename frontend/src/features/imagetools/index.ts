import { createImageToolsApp } from "./ImageToolsApp";
import type { ImageToolsOptions } from "./imagetoolsStore";
import { ImageToolsHttpGateway } from "./imagetoolsStore";

export { createImageToolsApp } from "./ImageToolsApp";
export {
  downscaleImage,
  FIT_MODES,
  FLIPS,
  formatBytes,
  OUTPUT_FORMATS,
  ROTATIONS,
} from "./imagetoolsLogic";
export type { ImageToolsOptions } from "./imagetoolsStore";
export { ImageToolsHttpGateway } from "./imagetoolsStore";

// Keep the setupXxxApp contract used by the vanilla plugin shell.
export function setupImageToolsApp(options: ImageToolsOptions) {
  return createImageToolsApp({
    gateway: options.gateway ?? new ImageToolsHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
