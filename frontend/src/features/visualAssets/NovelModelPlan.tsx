import { useState } from "react";
import { t } from "../../shared/i18n";
import type { CharacterFacet } from "./characterFacets";
import type { ManuscriptEvidence } from "./NovelChapterPicker";
import type { CharacterRequest } from "./useCharacterRecords";

type Choice = { provider: string; model: string; name: string; endpoint: string };
export type ModelPlan = {
  digest: string;
  model: Choice;
  prompt: string;
  promptBytes: number;
  maxPromptBytes: number;
  maxOutputTokens: number;
  timeoutSeconds: number;
  evidence: ManuscriptEvidence;
};

export function ModelPlanFields({ plan }: { plan: ModelPlan }) {
  return (
    <>
      <p>
        {plan.model.provider} · {plan.model.model} · {plan.model.endpoint}
      </p>
      <pre className="visual-assets-backup-path">{plan.prompt}</pre>
      <p>
        {t("Prompt bytes")} {plan.promptBytes}/{plan.maxPromptBytes} · {t("Maximum output tokens")}{" "}
        {plan.maxOutputTokens} · {t("Timeout (seconds)")} {plan.timeoutSeconds}
      </p>
      <p>{t("The provider may charge for this request. Cost is unknown.")}</p>
    </>
  );
}

export function NovelModelPlan({
  characterId,
  facet,
  baseVersion,
  evidence,
  request,
  disabled,
}: {
  characterId: string;
  facet: CharacterFacet;
  baseVersion: number | null;
  evidence: ManuscriptEvidence;
  request: CharacterRequest;
  disabled: boolean;
}) {
  const [choices, setChoices] = useState<Choice[]>();
  const [index, setIndex] = useState("");
  const [plan, setPlan] = useState<ModelPlan>();
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const choice = index === "" ? undefined : choices?.[Number(index)];
  const input = choice && {
    characterId,
    facet,
    baseVersion,
    evidence,
    provider: choice.provider,
    model: choice.model,
  };
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch {
      setMessage(t("Check the saved model tasks and chapter revision before trying again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={disabled || busy}>
      <legend>{t("Model suggestion")}</legend>
      {!choices && (
        <button
          type="button"
          className="ui-button"
          onClick={() =>
            void run(async () => {
              const result = (await request({ kind: "modelCatalog" })) as { models: Choice[] };
              setChoices(result.models);
            })
          }
        >
          {t("Choose a model")}
        </button>
      )}
      {choices?.length === 0 && <p>{t("No models available for this scene.")}</p>}
      {!!choices?.length && (
        <label>
          {t("Model")}{" "}
          <select
            value={index}
            onChange={(e) => {
              setIndex(e.target.value);
              setPlan(undefined);
              setMessage("");
            }}
          >
            <option value="">{t("Choose a model")}</option>
            {choices.map((item, i) => (
              <option key={JSON.stringify([item.provider, item.model])} value={i}>
                {item.name} · {item.provider} · {item.model}
              </option>
            ))}
          </select>
        </label>
      )}
      {input && (
        <button
          type="button"
          className="ui-button"
          onClick={() =>
            void run(async () => {
              setPlan(undefined);
              const next = (await request({ kind: "modelPreview", input })) as ModelPlan;
              setId(crypto.randomUUID());
              setPlan(next);
            })
          }
        >
          {t("Review the complete model request")}
        </button>
      )}
      {plan && (
        <>
          <ModelPlanFields plan={plan} />
          <button
            type="button"
            className="ui-button"
            onClick={() =>
              void run(async () => {
                setPlan(undefined);
                await request({
                  kind: "modelJob",
                  action: { kind: "submit", id, digest: plan.digest, confirmed: true, input },
                });
                setMessage(t("Request submitted. Open saved model tasks to review its status."));
              })
            }
          >
            {t("Authorize and send this request once")}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}
