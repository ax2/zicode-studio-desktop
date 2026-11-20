import { t } from "../../shared/i18n";
import type { CreationWorkflow } from "./creation-workflows";

// Business destinations stay explicit while the provider-backed workflows are built.
// Do not expose a fake Generate button or treat opening the library as generation.
export function CreationWorkspace({
  workflow,
  onOpenLibrary,
}: {
  workflow: CreationWorkflow;
  onOpenLibrary: () => void;
}) {
  return (
    <section className="ui-panel" aria-label={t(workflow.title)}>
      <h3>{t(workflow.title)}</h3>
      <p>{t(workflow.description)}</p>
      <dl>
        <dt>{t("Materials needed")}</dt>
        <dd>{t(workflow.inputs)}</dd>
        <dt>{t("Expected result")}</dt>
        <dd>{t(workflow.output)}</dd>
      </dl>
      <p role="status">
        {t(
          workflow.id === "outfit"
            ? "Outfit generation is being connected to configurable image models. It is not ready to generate yet."
            : "This workflow is planned after outfit generation. It is not ready to generate yet.",
        )}
      </p>
      <button type="button" className="ui-button ui-button--secondary" onClick={onOpenLibrary}>
        {t("Manage supporting materials")}
      </button>
    </section>
  );
}
