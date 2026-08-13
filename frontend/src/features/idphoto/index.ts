import { createIdPhotoApp } from "./IdPhotoApp";
import type { IdPhotoOptions } from "./idphotoStore";
import { IdPhotoHttpGateway } from "./idphotoStore";

export { createIdPhotoApp } from "./IdPhotoApp";
export { IdPhotoHttpGateway } from "./idphotoStore";
export type { IdPhotoOptions } from "./idphotoStore";
export {
  downscaleImage,
  formatResultSize,
  IDPHOTO_BACKGROUNDS,
  IDPHOTO_SHEETS,
  IDPHOTO_TEMPLATES,
} from "./idphotoLogic";

// Keep the setupXxxApp contract used by the vanilla plugin shell.
export function setupIdPhotoApp(options: IdPhotoOptions) {
  return createIdPhotoApp({
    gateway: options.gateway ?? new IdPhotoHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
