// Explicit receipt profiles; ordinary saves and imports retain their existing ceiling.
export const IMAGE_METADATA_OUTPUT = "resource.wasi.output.draft2";
export const IMAGE_METADATA_EXECUTION = "resource.wasi.image.metadata.v1";
export const IMAGE_METADATA_SAVE = "resource.save.image-metadata.v1";
export const LEGACY_RESOURCE_SAVE = "resource.save.draft1";
export const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
export function resourceSaveProfile(resource) {
  return resource?.outputProfile === IMAGE_METADATA_OUTPUT && IMAGE_MIMES.has(resource.mimeType)
    ? IMAGE_METADATA_SAVE : LEGACY_RESOURCE_SAVE;
}
export function savedResourceLimit(receipt) {
  if (receipt?.profile === LEGACY_RESOURCE_SAVE) return 32 * 1024 * 1024;
  if (receipt?.profile === IMAGE_METADATA_SAVE && IMAGE_MIMES.has(receipt.mimeType)) return 128 * 1024 * 1024;
  return 0;
}
