import { createIdPhotoApp } from "./IdPhotoApp";
import type { IdPhotoOptions } from "./idphotoStore";
import { IdPhotoHttpGateway } from "./idphotoStore";

export { createIdPhotoApp } from "./IdPhotoApp";
export {
  downscaleImage,
  formatResultSize,
  IDPHOTO_BACKGROUNDS,
  IDPHOTO_SHEETS,
  IDPHOTO_TEMPLATES,
} from "./idphotoLogic";
export type { IdPhotoOptions } from "./idphotoStore";
export { IdPhotoHttpGateway } from "./idphotoStore";

// Keep the setupXxxApp contract used by the vanilla plugin shell.
export function setupIdPhotoApp(options: IdPhotoOptions) {
  return createIdPhotoApp({
    gateway: options.gateway ?? new IdPhotoHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
