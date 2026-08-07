import { t } from "../../shared/i18n";
import type { SceneProfile } from "../settings/sceneProfiles";

export function SceneIndicatorApp({
  profile,
}: {
  profile: SceneProfile;
}) {
  return (
    <>
      <span className="scene-indicator-dot" aria-hidden="true" />
      <span className="scene-indicator-prefix">Scene</span>
      <strong id="scene-indicator-name">{t(profile.name)}</strong>
    </>
  );
}
