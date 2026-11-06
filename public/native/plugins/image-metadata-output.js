import { IMAGE_METADATA_EXECUTION, IMAGE_METADATA_OUTPUT, IMAGE_MIMES } from "./resource-save-policy.js";

const CAPABILITIES = new Set(["devtools.image.metadata.inspect", "devtools.image.metadata.clean"]);
const fail = () => { throw new Error("[resource_response_invalid]"); };
export function resourceExecutionProfile(instance, capabilityId) {
  return instance?.plugin?.capabilities?.find(capability => capability.id === capabilityId)?.executionProfile
    ?? instance?.resourceExecutionProfile ?? null;
}
export function resourceReadLimit(instance, capabilityId) {
  return resourceExecutionProfile(instance, capabilityId) === IMAGE_METADATA_EXECUTION && CAPABILITIES.has(capabilityId)
    ? 128 * 1024 * 1024 : 32 * 1024 * 1024;
}
export function imageMetadataOutputPolicy(response, executionProfile, capabilityId) {
  if (response.outputProfile !== IMAGE_METADATA_OUTPUT && executionProfile !== IMAGE_METADATA_EXECUTION) return null;
  if (response.outputProfile !== IMAGE_METADATA_OUTPUT || executionProfile !== IMAGE_METADATA_EXECUTION ||
      !CAPABILITIES.has(capabilityId) || response.result?.ok !== true) fail();
  const clean = capabilityId === "devtools.image.metadata.clean";
  if (response.result.operation !== (clean ? "clean" : "inspect") || response.result.previewIndex !== (clean ? 1 : 0) ||
      !Array.isArray(response.resources) || response.resources.length !== (clean ? 2 : 1)) fail();
  return {
    maxBytes: 130 * 1024 * 1024, maxRecords: 2,
    validate(row, index) {
      const thumbnail = !clean || index === 1;
      if (!IMAGE_MIMES.has(row.mimeType) || row.byteLength <= 0 ||
          row.byteLength > (thumbnail ? 2 : 128) * 1024 * 1024 || (thumbnail && row.mimeType !== "image/png")) fail();
    },
    label(index) { return clean && index === 0 ? "Cleaned image copy" : "Orientation preview thumbnail"; },
  };
}
