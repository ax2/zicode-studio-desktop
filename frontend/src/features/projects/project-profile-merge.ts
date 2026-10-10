import type { ProjectProfile } from "./logic";

export const PROFILE_FIELDS = ["instructions", "defaultScene", "budget"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export function canonicalProjectProfile(profile: ProjectProfile): ProjectProfile {
  return {
    instructions: typeof profile.instructions === "string" ? profile.instructions : "",
    defaultScene: typeof profile.defaultScene === "string" ? profile.defaultScene : "programming",
    budget: String(profile.budget ?? ""),
  };
}

/** Keep independent remote edits, and require a choice when both sides edit one field. */
export function mergeProjectProfile(
  base: ProjectProfile,
  draft: ProjectProfile,
  latest: ProjectProfile,
): { profile: ProjectProfile; conflicts: ProfileField[] } {
  const original = canonicalProjectProfile(base);
  const local = canonicalProjectProfile(draft);
  const saved = canonicalProjectProfile(latest);
  const profile = { ...local };
  const conflicts: ProfileField[] = [];
  for (const field of PROFILE_FIELDS) {
    if (local[field] === original[field]) {
      profile[field] = saved[field];
    } else if (saved[field] !== original[field] && saved[field] !== local[field]) {
      conflicts.push(field);
    }
  }
  return { profile, conflicts };
}
