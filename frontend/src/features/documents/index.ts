import { createDocumentsApp } from "./DocumentsApp";
import type { DocumentsOptions } from "./documentsStore";
import { DocumentsHttpGateway } from "./documentsStore";

export { createDocumentsApp } from "./DocumentsApp";
export type { DocumentImportResult } from "./documentsLogic";
export { isSupportedDocument, readFileAsDataUrl } from "./documentsLogic";
export type { DocumentsOptions, NotebookRef } from "./documentsStore";
export { DocumentsHttpGateway } from "./documentsStore";

export function setupDocumentsApp(options: DocumentsOptions) {
  return createDocumentsApp({
    gateway: options.gateway ?? new DocumentsHttpGateway(),
    getTarget: options.getTarget,
    notify: options.notify,
    listNotebooks: options.listNotebooks,
    saveToNotes: options.saveToNotes,
  });
}
