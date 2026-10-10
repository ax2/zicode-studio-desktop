import { t } from "../../shared/i18n.js";

export function toolPathError(error: unknown): string | undefined {
  if (error instanceof Error && error.message === "project_python_environment_invalid")
    return t(
      "The selected Python environment is unavailable. Open Development environment to repair it or switch to automatic selection.",
    );
  if (
    error instanceof Error &&
    ["project_environment_invalid", "project_environment_unavailable"].includes(error.message)
  )
    return t(
      "Project tool directories are unavailable. Open Development environment to reload or repair the saved paths.",
    );
}
