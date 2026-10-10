import { createOcrApp } from "./OcrApp";
import type { OcrOptions } from "./ocrStore";
import { OcrHttpGateway } from "./ocrStore";

export { createOcrApp } from "./OcrApp";
export type { OcrResult } from "./ocrLogic";
export { downscaleImage } from "./ocrLogic";
export type { OcrOptions } from "./ocrStore";
export { OcrHttpGateway } from "./ocrStore";

export function setupOcrApp(options: OcrOptions) {
  return createOcrApp({
    gateway: options.gateway ?? new OcrHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
    saveToNote: options.saveToNote,
  });
}
