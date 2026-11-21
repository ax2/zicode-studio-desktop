import { useCallback, useState } from "react";
import { t } from "../../shared/i18n";
import { OutfitImagePreview } from "./OutfitImagePreview";
import type { Invoke } from "./AssetLibrary";

type Model = { provider: string; model: string; name: string; endpoint: string };
type Hit = { id: number; name: string; matched: string[] };

export function SemanticSearch({
  invoke,
  workspaceId,
  sceneId,
  libraryId,
}: {
  invoke: Invoke;
  workspaceId: string;
  sceneId: string;
  libraryId: string;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ concepts: string[]; matches: Hit[] } | null>(null);

  const [preview, setPreview] = useState<Hit | null>(null);
  const request = useCallback(
    (value: Record<string, unknown>) =>
      invoke("visual_assets_control", { workspaceId, request: value }),
    [invoke, workspaceId],
  );
  async function perform(load: boolean) {
    setBusy(true);
    setError("");
    setPreview(null);
    setResult(null);
    try {
      if (load) {
        setSelected("");
        const response = (await request({
          kind: "queryModel",
          sceneId,
          action: { kind: "catalog" },
        })) as { models: Model[] };
        setModels(response.models);
        if (!response.models.length) setError(t("No search models are configured for this scene."));
        return;
      }
      const model = models[Number(selected)];
      if (!model || !selected || !query.trim()) return;
      const response = (await request({
        kind: "queryModel",
        sceneId,
        action: {
          kind: "expand",
          query: query.trim(),
          provider: model.provider,
          model: model.model,
        },
      })) as { cancelled?: boolean; concepts: string[] };
      if (response.cancelled) return;
      const page = (await request({
        kind: "searchConcepts",
        libraryId,
        query: query.trim(),
        concepts: response.concepts,
      })) as { matches: Hit[] };
      setResult({ concepts: response.concepts, matches: page.matches });
    } catch (e) {
      setError(
        t(
          String(e).includes("model_network_permission_required")
            ? "Allow network access for Visual assets in plugin permissions to use a search model."
            : "Model search failed. Check the model settings and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="visual-assets-tool visual-assets-search-results">
      <summary>{t("Semantic search")}</summary>
      <p>
        {t(
          "Send a search phrase to the selected model, then rank matching filenames and labels on this device.",
        )}
      </p>
      <div className="ui-toolbar">
        <button
          type="button"
          className="ui-button"
          disabled={busy}
          onClick={() => void perform(true)}
        >
          {t("Load search models")}
        </button>
        {models.length > 0 && (
          <select
            className="ui-input"
            aria-label={t("Search model")}
            value={selected}
            disabled={busy}
            onChange={(e) => {
              setSelected(e.target.value);
              setResult(null);
            }}
          >
            <option value="">{t("Select a model")}</option>
            {models.map((m, i) => (
              <option key={JSON.stringify([m.provider, m.model])} value={String(i)}>
                {m.provider} · {m.name} · {m.endpoint}
              </option>
            ))}
          </select>
        )}
        <input
          className="ui-input"
          aria-label={t("Search phrase")}
          placeholder={t("Search phrase")}
          maxLength={64}
          value={query}
          disabled={busy}
          onChange={(e) => {
            setQuery(e.target.value);
            setResult(null);
          }}
        />
        <button
          type="button"
          className="ui-button"
          disabled={busy || !selected || !query.trim()}
          onClick={() => void perform(false)}
        >
          {t("Review model search")}
        </button>
      </div>
      {busy && <p role="status">{t("Loading...")}</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div>
          <p>{result.concepts.join(" · ")}</p>
          {result.matches.length ? (
            <ol>
              {result.matches.map((hit) => (
                <li key={hit.id}>
                  <button type="button" className="ui-button" onClick={() => setPreview(hit)}>
                    {hit.name}
                  </button>{" "}
                  · {hit.matched.join("、")}
                </li>
              ))}
            </ol>
          ) : (
            <p>{t("No matching assets")}</p>
          )}
        </div>
      )}
      {result && preview && (
        <OutfitImagePreview
          request={request}
          libraryId={libraryId}
          assetId={preview.id}
          label={preview.name}
        />
      )}
    </details>
  );
}
