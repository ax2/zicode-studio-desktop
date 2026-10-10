import { validRecoveryProfile } from "./context-recovery-repository";
import type { ProjectProfile } from "./logic";

export interface PreparedContextRecovery {
  projectName: string;
  capturedAt: string;
  draft: ProjectProfile;
  base: ProjectProfile;
}

export type ImportedContextRecovery =
  | (PreparedContextRecovery & { kind: "draft" })
  | { kind: "saved-profile"; projectName: string; capturedAt: string; profile: ProjectProfile };

const invalidMessage = "Invalid project context recovery file.";

export async function readContextRecoveryFile(file: File): Promise<ImportedContextRecovery> {
  if (file.size > 1024 * 1024) throw new Error("Project context recovery file exceeds 1 MiB.");
  let value: unknown;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error(invalidMessage);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(invalidMessage);
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.projectName !== "string" ||
    !record.projectName.trim() ||
    record.projectName.length > 1024 ||
    typeof record.capturedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(record.capturedAt) ||
    Number.isNaN(Date.parse(record.capturedAt))
  )
    throw new Error(invalidMessage);
  if (record.format === "zicode-project-context-profile") {
    if (!validRecoveryProfile(record.profile)) throw new Error(invalidMessage);
    return {
      kind: "saved-profile",
      projectName: record.projectName,
      capturedAt: record.capturedAt,
      profile: {
        instructions: record.profile.instructions,
        defaultScene: record.profile.defaultScene,
        budget: record.profile.budget,
      },
    };
  }
  if (
    record.format !== "zicode-project-context-draft" ||
    !validRecoveryProfile(record.draft) ||
    !validRecoveryProfile(record.base)
  )
    throw new Error(invalidMessage);
  return {
    kind: "draft",
    projectName: record.projectName,
    capturedAt: record.capturedAt,
    draft: {
      instructions: record.draft.instructions,
      defaultScene: record.draft.defaultScene,
      budget: record.draft.budget,
    },
    base: {
      instructions: record.base.instructions,
      defaultScene: record.base.defaultScene,
      budget: record.base.budget,
    },
  };
}
