import { createOcrApp } from "./OcrApp";
import type { OcrOptions } from "./ocrStore";
import { OcrHttpGateway } from "./ocrStore";

export { createOcrApp } from "./OcrApp";
export { OcrHttpGateway } from "./ocrStore";
export type { OcrOptions } from "./ocrStore";
export { downscaleImage } from "./ocrLogic";
export type { OcrResult } from "./ocrLogic";

export function setupOcrApp(options: OcrOptions) {
  return createOcrApp({
    gateway: options.gateway ?? new OcrHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
