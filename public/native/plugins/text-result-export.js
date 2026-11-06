import { createResourceExport } from "./plugin-resource-export.js";
const profile = "result.export.text.draft1", uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// Reuse the same preview, separate confirmation and read-only recovery UI.
// Only a Host snapshot handle reaches native code, never editable text or a path.
export function createTextResultExport(options) {
  return createResourceExport({ ...options, profile,
    makeSource: (scope, result) => ({ scope, resultId: result.resultId }),
    validate: (value, grant, source, result) => value?.schemaVersion === 1 && value.profile === profile && uuid.test(value.grantId ?? "") &&
      (!grant || value.grantId === grant.grantId && value.destination === grant.preview.destination) &&
      typeof value.destination === "string" && value.destination.length > 0 && value.destination.length <= 32768 &&
      value.resultId === source.resultId && value.contentVersion === result.contentVersion && value.byteLength === result.byteLength && value.mimeType === "text/plain",
  });
}
