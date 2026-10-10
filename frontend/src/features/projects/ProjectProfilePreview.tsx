import { t } from "../../shared/i18n";
import type { ProjectProfile } from "./logic";

export function ProjectProfilePreview({ profile }: { profile: ProjectProfile }) {
  return (
    <div className="project-workspace-context-saved">
      <dl>
        <div>
          <dt>{t("Project instructions")}</dt>
          <dd>{profile.instructions || "—"}</dd>
        </div>
        <div>
          <dt>{t("Default scene")}</dt>
          <dd>{profile.defaultScene || "—"}</dd>
        </div>
        <div>
          <dt>{t("Session budget")}</dt>
          <dd>{profile.budget || "—"}</dd>
        </div>
      </dl>
    </div>
  );
}
