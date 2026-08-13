import { createClipboardApp } from "./ClipboardApp";
import type { ClipboardOptions } from "./clipboardStore";
import { ClipboardHttpGateway } from "./clipboardStore";

export { createClipboardApp } from "./ClipboardApp";
export { ClipboardHttpGateway } from "./clipboardStore";
export type { ClipboardOptions } from "./clipboardStore";
export { formatCreatedAt } from "./clipboardLogic";
export type { ClipboardItem } from "./clipboardLogic";

export function setupClipboardApp(options: ClipboardOptions) {
  return createClipboardApp({
    gateway: options.gateway ?? new ClipboardHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
    saveToNote: options.saveToNote,
  });
}
