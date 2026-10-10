import { useEffect, useState } from "react";
import { friendlyPluginError } from "./hostErrors";
import { t } from "./i18n";

export interface ModelToolChoice {
  provider: string;
  model: string;
  name: string;
  endpoint: string;
  requiresKey: boolean;
}
export interface ModelToolSelection {
  sceneId: string;
  provider: string;
  model: string;
}

export function ModelToolPicker({
  sceneId,
  value,
  onChange,
  load,
  disabled = false,
}: {
  sceneId: string;
  value: ModelToolSelection | null;
  onChange(value: ModelToolSelection | null): void;
  load(): Promise<ModelToolChoice[]>;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<ModelToolChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scene changes and explicit refresh must reload the stable gateway callback.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setModels([]);
    void load()
      .then((items) => {
        if (!Array.isArray(items)) throw new Error("model_response_invalid");
        if (active)
          setModels([
            ...new Map(
              items.map((item) => [JSON.stringify([item.provider, item.model]), item]),
            ).values(),
          ]);
      })
      .catch((reason) => {
        if (active) setError(friendlyPluginError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load, sceneId, refresh]);
  const selected =
    value?.sceneId === sceneId
      ? models.findIndex((item) => item.provider === value.provider && item.model === value.model)
      : -1;
  return (
    <section aria-label={t("Model service")}>
      <label>
        <span>{t("Model service")}</span>
        <select
          className="ui-input"
          disabled={disabled || loading}
          value={selected < 0 ? "" : String(selected)}
          onChange={(event) => {
            const item = event.target.value === "" ? null : models[Number(event.target.value)];
            onChange(item ? { sceneId, provider: item.provider, model: item.model } : null);
          }}
        >
          <option value="">{t("Choose a configured model")}</option>
          {models.map((item, index) => (
            <option key={JSON.stringify([item.provider, item.model])} value={index}>
              {item.provider} / {item.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="ui-button ui-button--ghost ui-button--sm"
        disabled={disabled || loading}
        onClick={() => {
          onChange(null);
          setRefresh((n) => n + 1);
        }}
      >
        {t("Refresh models")}
      </button>
      {loading ? (
        <p role="status">{t("Loading models…")}</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : models.length === 0 ? (
        <p role="status">
          {t(
            "Add an OpenAI-compatible channel and models in Settings. Local services can disable authentication.",
          )}
        </p>
      ) : null}
      {selected >= 0 && (
        <p>
          {t("Text is sent to the selected model service:")} {models[selected].endpoint}
        </p>
      )}
    </section>
  );
}
