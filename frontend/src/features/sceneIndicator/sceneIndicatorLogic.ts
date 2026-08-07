import {
  normalizeSceneId,
  type SceneProfile,
} from "../settings/sceneProfiles";

export interface WelcomeScene {
  id: string;
  name: string;
  description: string;
}

export function resolveActiveProfile(
  profiles: SceneProfile[],
  sceneId: string,
): SceneProfile {
  return (
    profiles.find((profile) => profile.id === sceneId) || {
      id: sceneId,
      name: sceneId,
      description: "Custom scene with isolated configuration and runtime data.",
    }
  );
}

export function toWelcomeScene(profile: SceneProfile): WelcomeScene {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description || "",
  };
}

export { normalizeSceneId };
export type { SceneProfile };
