import { useState } from "react";
import { t } from "../../shared/i18n";
import { AssetLibrary, type Invoke } from "./AssetLibrary";
import { CreationWorkspace } from "./CreationWorkspace";
import { type CreationWorkflowId, creationWorkflows } from "./creation-workflows";
import { OutfitWorkspace } from "./OutfitWorkspace";

export type { Invoke } from "./AssetLibrary";

export function VisualAssetsApp(props: { invoke: Invoke; workspaceId: string; sceneId?: string }) {
  const [view, setView] = useState<"home" | "library" | CreationWorkflowId>("home");
  const selected = creationWorkflows.find((entry) => entry.id === view);
  return (
    <section className="visual-assets-main visual-assets-shell" aria-label={t("Visual creation studio")}>
      <header className="visual-assets-masthead">
        <h2>{t("Visual assets")}</h2>
        <nav className="visual-assets-nav" aria-label={t("Visual creation navigation")}>
          <button
            type="button"
            className="ui-button"
            aria-current={view === "home" ? "page" : undefined}
            onClick={() => setView("home")}
          >
            {t("Creation home")}
          </button>
          <button
            type="button"
            className="ui-button ui-button--secondary"
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => setView("library")}
          >
            {t("Materials and library")}
          </button>
        </nav>
      </header>
      {view === "home" && (
        <>
          <div className="visual-assets-intro"><h3>{t("What would you like to create?")}</h3>
          <p>{t("Start with a creative task. Choose or add materials when you need them.")}</p></div>
          <div className="visual-assets-workflows">
            {creationWorkflows.map((workflow) => (
              <section className="ui-card visual-assets-workflow" key={workflow.id}>
                <h3>{t(workflow.title)}</h3>
                <p>{t(workflow.description)}</p>
                <p className="visual-assets-workflow-inputs">{t(workflow.inputs)}</p>
                <button
                  type="button"
                  className={`ui-button${workflow.id === "outfit" ? " ui-button--primary" : ""}`}
                  onClick={() => setView(workflow.id)}
                >
                  {t("Open workflow")} · {t(workflow.title)}
                </button>
              </section>
            ))}
          </div>
        </>
      )}
      {view === "library" && <AssetLibrary {...props} />}
      {(view === "outfit" || view === "style" || view === "generate") && (
        <OutfitWorkspace {...props} workflow={view} />
      )}
      {selected && view !== "outfit" && view !== "style" && view !== "generate" && (
        <CreationWorkspace
          key={selected.id}
          workflow={selected}
          onOpenLibrary={() => setView("library")}
        />
      )}
    </section>
  );
}
