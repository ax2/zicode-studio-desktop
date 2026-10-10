import { createTranslationApp } from "./TranslationApp";
import type { TranslationOptions } from "./translationStore";
import { TranslationHttpGateway } from "./translationStore";

export { createTranslationApp } from "./TranslationApp";
export type { TranslationResult } from "./translationLogic";
export { TARGET_LANGUAGES } from "./translationLogic";
export type { TranslationOptions } from "./translationStore";
export { TranslationHttpGateway } from "./translationStore";

export function setupTranslationApp(options: TranslationOptions) {
  return createTranslationApp({
    gateway: options.gateway ?? new TranslationHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
  });
}
