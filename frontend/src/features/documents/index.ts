import { createDocumentsApp } from "./DocumentsApp";
import type { DocumentsOptions } from "./documentsStore";
import { DocumentsHttpGateway } from "./documentsStore";

export { createDocumentsApp } from "./DocumentsApp";
export { DocumentsHttpGateway } from "./documentsStore";
export type { DocumentsOptions } from "./documentsStore";
export { isSupportedDocument, readFileAsDataUrl } from "./documentsLogic";
export type { DocumentImportResult } from "./documentsLogic";

export function setupDocumentsApp(options: DocumentsOptions) {
  return createDocumentsApp({
    gateway: options.gateway ?? new DocumentsHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
    saveToNotes: options.saveToNotes,
  });
}
