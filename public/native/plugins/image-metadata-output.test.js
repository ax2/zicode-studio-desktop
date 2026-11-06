import { describe, expect, it } from "vitest";
import { normalizeResourceOutputs } from "./plugin-resource-outputs.js";
import { IMAGE_METADATA_EXECUTION, IMAGE_METADATA_OUTPUT, IMAGE_METADATA_SAVE, resourceSaveProfile, savedResourceLimit } from "./resource-save-policy.js";
import { resourceReadLimit } from "./image-metadata-output.js";

const hash = "a".repeat(64);
const source = { capabilityId: "devtools.image.metadata.clean", resourceId: "11111111-1111-4111-8111-111111111111", contentVersion: hash };
function response() {
  return { outputProfile: IMAGE_METADATA_OUTPUT, result: { ok: true, operation: "clean", previewIndex: 1 }, resources: [
    { index: 0, resourceId: "22222222-2222-4222-8222-222222222222", contentVersion: hash, mimeType: "image/png", byteLength: 32 * 1024 * 1024 + 1,
      expiresInSeconds: 900, origin: "worker-output", saved: false, derivedFrom: { resourceId: source.resourceId, contentVersion: hash } },
    { index: 1, resourceId: "33333333-3333-4333-8333-333333333333", contentVersion: hash, mimeType: "image/png", byteLength: 100,
      expiresInSeconds: 900, origin: "worker-output", saved: false, derivedFrom: { resourceId: source.resourceId, contentVersion: hash } },
  ] };
}
describe("explicit metadata image output", () => {
  it("requires output negotiation for success while allowing a Host failure without any outputs", () => {
    expect(() => normalizeResourceOutputs({ result: { ok: true, operation: "clean" } }, source, IMAGE_METADATA_EXECUTION)).toThrow("resource_response_invalid");
    expect(normalizeResourceOutputs({ result: { ok: false, error: { code: "IMAGE_METADATA_FAILED" } } }, source, IMAGE_METADATA_EXECUTION)).toBeNull();
    expect(normalizeResourceOutputs({ result: { text: "legacy" } }, source)).toBeNull();
  });
  it("admits a full image beyond the old limit only under the matching live execution profile", () => {
    const result = normalizeResourceOutputs(response(), source, IMAGE_METADATA_EXECUTION);
    expect(result.map(resource => resource.outputLabel)).toEqual(["Cleaned image copy", "Orientation preview thumbnail"]);
    expect(result[0].byteLength).toBe(32 * 1024 * 1024 + 1);
    expect(resourceSaveProfile(result[0])).toBe(IMAGE_METADATA_SAVE);
    expect(() => normalizeResourceOutputs(response(), source)).toThrow("resource_response_invalid");
    expect(() => normalizeResourceOutputs(response(), source, "resource.wasi.image.resize.v1")).toThrow("resource_response_invalid");
    const legacy = response();legacy.outputProfile = "resource.wasi.output.draft1";
    expect(() => normalizeResourceOutputs(legacy, source)).toThrow("resource_response_invalid");
    expect(() => normalizeResourceOutputs(legacy, source, IMAGE_METADATA_EXECUTION)).toThrow("resource_response_invalid");
  });
  it.each([
    result => { result.resources[0].byteLength = 128 * 1024 * 1024 + 1; },
    result => { result.resources[1].byteLength = 2 * 1024 * 1024 + 1; },
    result => { result.resources[1].mimeType = "image/jpeg"; },
    result => { result.resources[0].mimeType = "text/plain"; },
    result => { result.resources[0].byteLength = 0; },
    result => { result.resources.pop(); },
    result => { result.result.previewIndex = 0; },
    result => { result.result.operation = "inspect"; },
  ])("rejects a mismatched full image, thumbnail, role, or byte budget", mutate => {
    const result = response();mutate(result);
    expect(() => normalizeResourceOutputs(result, source, IMAGE_METADATA_EXECUTION)).toThrow("resource_response_invalid");
  });
  it("keeps legacy receipt and read budgets while admitting only explicitly typed metadata images", () => {
    expect(savedResourceLimit({ profile: "resource.save.draft1", mimeType: "image/png" })).toBe(32 * 1024 * 1024);
    expect(savedResourceLimit({ profile: IMAGE_METADATA_SAVE, mimeType: "image/png" })).toBe(128 * 1024 * 1024);
    expect(savedResourceLimit({ profile: IMAGE_METADATA_SAVE, mimeType: "text/plain" })).toBe(0);
    expect(savedResourceLimit({ profile: "unknown", mimeType: "image/png" })).toBe(0);
    expect(resourceReadLimit({ plugin: { id: "fixture" } }, source.capabilityId)).toBe(32 * 1024 * 1024);
    expect(resourceReadLimit({ resourceExecutionProfile: IMAGE_METADATA_EXECUTION }, source.capabilityId)).toBe(128 * 1024 * 1024);
    expect(resourceReadLimit({ resourceExecutionProfile: IMAGE_METADATA_EXECUTION }, "unrelated.capability")).toBe(32 * 1024 * 1024);
  });
});
