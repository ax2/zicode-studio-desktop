// Fast, read-only hints for declarations that Studio's Host requires.
// The Host remains authoritative for versions, schemas, permissions and runtime behavior.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const declarations = [
  ["directory", "tool.directory.v1"],
  ["fileInput", "file.input.hints.v1"],
  ["resourceInputMimeTypes", "resource.input.types.v1"],
  ["outputSchema", "output.schema.v1"],
  ["maxResultBytes", "output.schema.v1"],
  ["resultCaptureMimeType", "result.json.v1"],
];

export function missingPluginProfiles(manifest) {
  const profiles = manifest?.requiredProfiles;
  const declared =
    profiles && typeof profiles === "object" && !Array.isArray(profiles) ? profiles : {};
  const issues = [];
  const activities = manifest?.contributes?.activities;
  if (Array.isArray(activities)) {
    for (const [index, activity] of activities.entries()) {
      if (activity && typeof activity === "object" && !Array.isArray(activity) &&
        Object.hasOwn(activity, "directory") && !Object.hasOwn(declared, "application.directory.v1")) {
        issues.push({ capabilityId: activity.id ?? `#activity-${index}`,
          profile: "application.directory.v1", fields: ["directory"] });
      }
    }
  }
  if (Array.isArray(manifest?.contributes?.viewOperations) &&
    !Object.hasOwn(declared, "view.operation.directory.v1")) {
    for (const [index, operation] of manifest.contributes.viewOperations.entries()) {
      issues.push({ capabilityId: operation?.id ?? `#view-operation-${index}`,
        profile: "view.operation.directory.v1", fields: ["viewOperations"] });
    }
  }
  const capabilities = manifest?.contributes?.capabilities;
  if (!Array.isArray(capabilities)) return issues;
  for (const [index, capability] of capabilities.entries()) {
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) continue;
    const missing = new Map();
    for (const [field, profile] of declarations) {
      if (Object.hasOwn(capability, field) && !Object.hasOwn(declared, profile)) {
        if (!missing.has(profile)) missing.set(profile, []);
        missing.get(profile).push(field);
      }
    }
    const executionProfile = capability.executionProfile;
    if (
      typeof executionProfile === "string" &&
      executionProfile &&
      !Object.hasOwn(declared, executionProfile)
    ) {
      missing.set(executionProfile, ["executionProfile"]);
    }
    if (
      executionProfile === "resource.wasi.image.resize.v1" &&
      !Object.hasOwn(declared, "resource.output.types.v1")
    ) {
      missing.set("resource.output.types.v1", ["executionProfile"]);
    }
    for (const [profile, fields] of missing) {
      issues.push({ capabilityId: capability.id ?? `#${index}`, profile, fields });
    }
  }
  return issues;
}

export function unusedPluginProfiles(manifest) {
  const profiles = manifest?.requiredProfiles;
  if (
    !profiles ||
    typeof profiles !== "object" ||
    Array.isArray(profiles) ||
    !Object.hasOwn(profiles, "output.schema.v1")
  )
    return [];
  const capabilities = manifest?.contributes?.capabilities;
  if (
    Array.isArray(capabilities) &&
    capabilities.some(
      (capability) =>
        capability &&
        typeof capability === "object" &&
        !Array.isArray(capability) &&
        (Object.hasOwn(capability, "outputSchema") || Object.hasOwn(capability, "maxResultBytes")),
    )
  )
    return [];
  return [
    {
      capabilityId: "#manifest",
      profile: "output.schema.v1",
      fields: ["outputSchema", "maxResultBytes"],
      reason: "declared_without_output_contract",
    },
  ];
}

export function invalidPluginProfiles(manifest) {
  const profiles = manifest?.requiredProfiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles) ||
    !Object.hasOwn(profiles, "tool.open.v1")) return [];
  const issues = [];
  const profile = "tool.open.v1";
  if (manifest.schemaVersion !== 2) issues.push({ capabilityId: "#manifest", profile,
    fields: ["schemaVersion"], reason: "requires_schema_version_2" });
  if (profiles[profile] !== "=1.0.0-preview.1") issues.push({ capabilityId: "#manifest", profile,
    fields: ["requiredProfiles.tool.open.v1"], reason: "unsupported_profile_version" });
  if (!Array.isArray(manifest?.contributes?.views) ||
    !manifest.contributes.views.some((view) => view?.location === "main")) {
    issues.push({ capabilityId: "#manifest", profile, fields: ["contributes.views"],
      reason: "main_view_required" });
  }
  if (!Array.isArray(manifest?.contributes?.capabilities) ||
    manifest.contributes.capabilities.length === 0) {
    issues.push({ capabilityId: "#manifest", profile, fields: ["contributes.capabilities"],
      reason: "capability_required" });
  }
  return issues;
}

export function invalidViewOperationProfiles(manifest) {
  const profile = "view.operation.directory.v1";
  const profiles = manifest?.requiredProfiles;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles) ||
    !Object.hasOwn(profiles, profile)) return [];
  const issues = [];
  if (manifest.schemaVersion !== 2) issues.push({ capabilityId: "#manifest", profile,
    fields: ["schemaVersion"], reason: "requires_schema_version_2" });
  if (profiles[profile] !== "=1.0.0-preview.1") issues.push({ capabilityId: "#manifest", profile,
    fields: [`requiredProfiles.${profile}`], reason: "unsupported_profile_version" });
  const views = manifest?.contributes?.views;
  const mainIds = new Set(Array.isArray(views) ? views.filter(view => view?.location === "main")
    .map(view => view?.id) : []);
  if (!mainIds.size) issues.push({ capabilityId: "#manifest", profile,
    fields: ["contributes.views"], reason: "main_view_required" });
  const operations = manifest?.contributes?.viewOperations;
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 128) {
    issues.push({ capabilityId: "#manifest", profile, fields: ["contributes.viewOperations"],
      reason: "view_operations_required" });
  } else for (const [index, operation] of operations.entries()) {
    if (!mainIds.has(operation?.viewId)) issues.push({
      capabilityId: operation?.id ?? `#view-operation-${index}`, profile, fields: ["viewId"],
      reason: "declared_main_view_required",
    });
  }
  return issues;
}

export async function preflightPluginManifestPaths(paths) {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 256)
    throw new Error("usage: check-plugin-manifest-profiles <plugin.json> [plugin.json ...] (up to 256)");
  const seen = new Set();
  const manifests = [];
  for (const path of paths) {
    const absolute = resolve(path);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    try {
      const bytes = await readFile(absolute);
      if (bytes.length > 1024 * 1024) throw new Error("manifest_too_large");
      const manifest = JSON.parse(bytes.toString("utf8"));
      manifests.push({
        path,
        issues: [...missingPluginProfiles(manifest), ...unusedPluginProfiles(manifest),
          ...invalidPluginProfiles(manifest), ...invalidViewOperationProfiles(manifest)],
      });
    } catch (error) {
      manifests.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return manifests;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifests = await preflightPluginManifestPaths(process.argv.slice(2));
    const single = manifests.length === 1;
    const report = single
      ? {
          preflightOnly: true,
          hostAccepted: false,
          ...(manifests[0].error
            ? { error: manifests[0].error }
            : { issues: manifests[0].issues }),
        }
      : { preflightOnly: true, hostAccepted: false, manifests };
    console.log(JSON.stringify(report, null, 2));
    if (manifests.some((manifest) => manifest.error)) process.exitCode = 2;
    else if (manifests.some((manifest) => manifest.issues.length)) process.exitCode = 1;
  } catch (error) {
    console.error(
      JSON.stringify({
        preflightOnly: true,
        hostAccepted: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 2;
  }
}
