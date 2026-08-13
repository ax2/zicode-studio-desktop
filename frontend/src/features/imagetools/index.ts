import { createImageToolsApp } from "./ImageToolsApp";
import type { ImageToolsOptions } from "./imagetoolsStore";
import { ImageToolsHttpGateway } from "./imagetoolsStore";

export { createImageToolsApp } from "./ImageToolsApp";
export { ImageToolsHttpGateway } from "./imagetoolsStore";
export type { ImageToolsOptions } from "./imagetoolsStore";
export {
  downscaleImage,
  formatBytes,
  OUTPUT_FORMATS,
  FIT_MODES,
  ROTATIONS,
  FLIPS,
} from "./imagetoolsLogic";

// Keep the setupXxxApp contract used by the vanilla plugin shell.
export function setupImageToolsApp(options: ImageToolsOptions) {
  return createImageToolsApp({
    gateway: options.gateway ?? new ImageToolsHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
