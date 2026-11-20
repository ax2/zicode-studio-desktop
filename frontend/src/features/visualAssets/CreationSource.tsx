import { useState } from "react";
import { t } from "../../shared/i18n";
import { GenerationSummary } from "./GenerationFields";
import { imageWorkflowLabel } from "./generation-types";
import { type ImageUsage, OutfitUsage } from "./OutfitUsage";
import type { OutfitPlan } from "./outfit-types";
import { StyleSummary } from "./StyleFields";
import type { Invoke } from "./VisualAssetsApp";

export function CreationSource({
  id,
  invoke,
  workspaceId,
  sceneId,
  libraryId,
}: {
  id: string;
  invoke: Invoke;
  workspaceId: string;
  sceneId?: string;
  libraryId: string;
}) {
  const [plan, setPlan] = useState<OutfitPlan>();
  const [usage, setUsage] = useState<ImageUsage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function load() {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const value = (await invoke("visual_assets_control", {
        workspaceId,
        request: {
          kind: "creation",
          libraryId,
          sceneId: sceneId || "visual-creation",
          action: { kind: "source", id },
        },
      })) as { plan: OutfitPlan; usage?: ImageUsage };
      setPlan(value.plan);
      setUsage(value.usage);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="visual-assets-backup-path">
      <summary>{t("Image generation source")}</summary>
      <button type="button" className="ui-button" disabled={busy} onClick={() => void load()}>
        {t("Read saved image source")}
      </button>
      {plan && (
        <>
          <p>
            {plan.settings.model} · {plan.settings.baseUrl}
          </p>
          <p>{t(imageWorkflowLabel(plan.workflow))}</p>
          <p>{plan.input.description}</p>
          {plan.input.style && <StyleSummary value={plan.input.style} />}
          {plan.input.generation && <GenerationSummary value={plan.input.generation} />}
          <p>
            {t("Source images")} · {plan.references.map((reference) => reference.name).join(" · ")}
          </p>
          <details>
            <summary>{t("Full image prompt")}</summary>
            <pre className="visual-assets-prompt">{plan.prompt}</pre>
          </details>
          <p>
            {t("Request ID")} · {id}
          </p>
          <OutfitUsage usage={usage} />
        </>
      )}
      {error && (
        <p role="alert">
          {t("Could not read the saved image source. Retry after the library is available.")}
        </p>
      )}
    </details>
  );
}
