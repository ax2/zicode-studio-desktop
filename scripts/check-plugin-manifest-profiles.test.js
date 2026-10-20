import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  invalidPluginProfiles,
  invalidViewOperationProfiles,
  missingPluginProfiles,
  preflightPluginManifestPaths,
  unusedPluginProfiles,
} from "./check-plugin-manifest-profiles.mjs";

it("preflights the optional tool.open profile's exact version and required View and capability", () => {
  const manifest = JSON.parse(readFileSync(
    resolve("tests/fixtures/studio-tool-open-profile/plugin.json"), "utf8"));
  expect(invalidPluginProfiles(manifest)).toEqual([]);
  manifest.schemaVersion = 1;
  manifest.requiredProfiles["tool.open.v1"] = "^1.0.0";
  manifest.contributes.views = [{ location: "sidebar" }];
  manifest.contributes.capabilities = [];
  expect(invalidPluginProfiles(manifest)).toEqual([
    { capabilityId: "#manifest", profile: "tool.open.v1", fields: ["schemaVersion"],
      reason: "requires_schema_version_2" },
    { capabilityId: "#manifest", profile: "tool.open.v1",
      fields: ["requiredProfiles.tool.open.v1"], reason: "unsupported_profile_version" },
    { capabilityId: "#manifest", profile: "tool.open.v1", fields: ["contributes.views"],
      reason: "main_view_required" },
    { capabilityId: "#manifest", profile: "tool.open.v1", fields: ["contributes.capabilities"],
      reason: "capability_required" },
  ]);
});

it("preflights View-only operation directory declarations without treating them as capabilities", () => {
  const manifest = { schemaVersion: 2, requiredProfiles: {}, contributes: {
    views: [{ id: "example.main", location: "main" }],
    viewOperations: [{ id: "example.health", viewId: "example.main", title: "Health",
      directory: { categoryId: "system" } }], capabilities: [],
  } };
  expect(missingPluginProfiles(manifest)).toEqual([{ capabilityId: "example.health",
    profile: "view.operation.directory.v1", fields: ["viewOperations"] }]);
  manifest.requiredProfiles["view.operation.directory.v1"] = "=1.0.0-preview.1";
  expect(missingPluginProfiles(manifest)).toEqual([]);
  expect(invalidViewOperationProfiles(manifest)).toEqual([]);
  manifest.contributes.viewOperations[0].viewId = "other.main";
  expect(invalidViewOperationProfiles(manifest)).toEqual([{ capabilityId: "example.health",
    profile: "view.operation.directory.v1", fields: ["viewId"],
    reason: "declared_main_view_required" }]);
});

it("reports both missing profiles in the frozen URL text candidate", () => {
  const manifest = JSON.parse(
    readFileSync(
      resolve("tests/fixtures/devtools-url-text-resource-candidate02/plugin.json"),
      "utf8",
    ),
  );
  expect(missingPluginProfiles(manifest)).toEqual([
    {
      capabilityId: "devtools.transforms.url.encode",
      profile: "tool.directory.v1",
      fields: ["directory"],
    },
    {
      capabilityId: "devtools.transforms.url.encode",
      profile: "output.schema.v1",
      fields: ["outputSchema", "maxResultBytes"],
    },
  ]);
});

it("does not treat a declaration hint as Host acceptance", () => {
  const manifest = {
    requiredProfiles: {
      "tool.directory.v1": "=1.0.0-preview.1",
      "file.input.hints.v1": "=1.0.0-preview.1",
      "resource.input.types.v1": "=1.0.0-preview.1",
      "output.schema.v1": "=1.0.0-rc.1",
    },
    contributes: {
      capabilities: [
        {
          id: "example",
          directory: {},
          fileInput: {},
          resourceInputMimeTypes: [],
          outputSchema: {},
          maxResultBytes: 1,
        },
      ],
    },
  };
  expect(missingPluginProfiles(manifest)).toEqual([]);
});

it("preflights a View-only application directory declaration", () => {
  const manifest = { contributes: { activities: [{ id: "service", directory: { categoryId: "system" } }] } };
  expect(missingPluginProfiles(manifest)).toEqual([{ capabilityId: "service",
    profile: "application.directory.v1", fields: ["directory"] }]);
  manifest.requiredProfiles = { "application.directory.v1": "=1.0.0-preview.1" };
  expect(missingPluginProfiles(manifest)).toEqual([]);
});

it("reports the capability execution profile and its resource output dependency", () => {
  const jsonManifest = {
    requiredProfiles: { "output.schema.v1": "=1.0.0-rc.1" },
    contributes: { capabilities: [{ id: "structured", outputSchema: { type: "object" },
      resultCaptureMimeType: "application/json" }] },
  };
  expect(missingPluginProfiles(jsonManifest)).toEqual([{
    capabilityId: "structured", profile: "result.json.v1", fields: ["resultCaptureMimeType"],
  }]);
  const capability = {
    id: "images.resize",
    executionProfile: "resource.wasi.image.resize.v1",
    outputSchema: { type: "object" },
  };
  const manifest = {
    requiredProfiles: { "output.schema.v1": "=1.0.0-rc.1" },
    contributes: { capabilities: [capability] },
  };
  expect(missingPluginProfiles(manifest)).toEqual([
    {
      capabilityId: "images.resize",
      profile: "resource.wasi.image.resize.v1",
      fields: ["executionProfile"],
    },
    {
      capabilityId: "images.resize",
      profile: "resource.output.types.v1",
      fields: ["executionProfile"],
    },
  ]);
  manifest.requiredProfiles["resource.wasi.image.resize.v1"] = "=1.0.0-preview.1";
  manifest.requiredProfiles["resource.output.types.v1"] = "=1.0.0-preview.1";
  expect(missingPluginProfiles(manifest)).toEqual([]);
});

it("flags an output profile with no output contract, without changing frozen candidates", () => {
  const manifest = {
    requiredProfiles: { "output.schema.v1": "=1.0.0-rc.1" },
    contributes: { capabilities: [{ id: "example", inputSchema: { type: "object" } }] },
  };
  expect(unusedPluginProfiles(manifest)).toEqual([
    {
      capabilityId: "#manifest",
      profile: "output.schema.v1",
      fields: ["outputSchema", "maxResultBytes"],
      reason: "declared_without_output_contract",
    },
  ]);
  manifest.contributes.capabilities[0].maxResultBytes = 49152;
  expect(unusedPluginProfiles(manifest)).toEqual([]);
});

it("reports each explicit plugin manifest independently and deduplicates repeated paths", async () => {
  const candidate = "tests/fixtures/devtools-url-text-resource-candidate02/plugin.json";
  const compatible = "tests/fixtures/devtools-agent-assist-candidate03/plugin.json";
  const reports = await preflightPluginManifestPaths([candidate, compatible, candidate]);
  expect(reports.map((report) => report.path)).toEqual([candidate, compatible]);
  expect(reports[0].issues.map((issue) => issue.profile)).toEqual([
    "tool.directory.v1",
    "output.schema.v1",
  ]);
  expect(reports[1].issues).toEqual([]);
});
