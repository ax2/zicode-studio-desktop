export const IMAGE_METADATA_OUTPUT: "resource.wasi.output.draft2";
export const IMAGE_METADATA_EXECUTION: "resource.wasi.image.metadata.v1";
export const IMAGE_METADATA_SAVE: "resource.save.image-metadata.v1";
export const LEGACY_RESOURCE_SAVE: "resource.save.draft1";
export const IMAGE_MIMES: Set<string>;
export function resourceSaveProfile(resource: {outputProfile?: string; mimeType?: string}): string;
export function savedResourceLimit(receipt: {profile?: unknown; mimeType?: unknown} | null | undefined): number;
