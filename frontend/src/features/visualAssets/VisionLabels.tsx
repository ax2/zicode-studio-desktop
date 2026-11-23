import { useState } from "react";
import { t } from "../../shared/i18n";
import type { Invoke } from "./AssetLibrary";

export type VisionRecord = {
  id: string;
  provider: string;
  model: string;
  endpointOrigin: string;
  previewSha: string;
  reviewedAt?: number;
  approved: boolean;
  labels: string[];
};
type Model = { provider: string; model: string; endpoint: string; supportsImages?: boolean };
function visionError(error: unknown): string {
  const code = error instanceof Error ? error.message : error;
  if (typeof code === "string") {
    const status = /^model_request_failed:([1-5][0-9]{2})$/.exec(code);
    if (status) {
      return t("The model service returned HTTP {status}.").replace("{status}", status[1]);
    }
    switch (code) {
      case "visual_assets_model_network_permission_required":
      case "model_network_permission_required":
        return t("Allow network access for Visual assets in plugin permissions to use a search model.");
      case "visual_assets_model_credential_unavailable":
      case "model_credential_unavailable":
        return t("Configure the model credential for this Studio profile.");
      case "visual_assets_vision_model_required":
        return t("Select a model that supports image input.");
      case "model_selection_required":
      case "model_selection_ambiguous":
      case "model_selection_unavailable":
      case "visual_assets_model_config_changed":
        return t("Reload the image model list and select the destination again.");
      case "model_client_unavailable":
      case "model_request_unavailable":
        return t("The model service could not be reached. Check the connection and service address.");
      case "model_response_invalid":
      case "visual_assets_model_response_unusable":
        return t("The model response could not be read as a list of image labels.");
      case "model_response_too_large":
        return t("The model response exceeded the size limit.");
      case "model_request_cancelled":
        return t("The model request was cancelled.");
      case "visual_assets_busy":
        return t("A model request is already in progress.");
      case "visual_assets_window_changed":
      case "visual_assets_tags_changed":
      case "visual_assets_library_changed":
      case "visual_assets_preview_unavailable":
        return t("Refresh the asset and review its current thumbnail and labels.");
    }
  }
  return t("Image recognition failed. Check the selected model or refresh and try again.");
}

export function VisionLabels({
  invoke,
  workspaceId,
  sceneId,
  libraryId,
  assetId,
  digest,
  preview,
  records,
  refresh,
}: {
  invoke: Invoke;
  workspaceId: string;
  sceneId: string;
  libraryId: string;
  assetId: number;
  digest: string;
  preview: string;
  records: VisionRecord[];
  refresh: () => void;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [omitted, setOmitted] = useState<string[]>([]);
  const pending = records.find((r) => !r.approved);
  const approved = records.find((r) => r.approved);
  const request = (r: Record<string, unknown>) =>
    invoke("visual_assets_control", { workspaceId, request: r });
  async function act(f: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await f();
    } catch (e) {
      setError(visionError(e));
    } finally {
      setBusy(false);
    }
  }
  async function catalog() {
    const { models } = (await request({
      kind: "queryModel",
      sceneId,
      action: { kind: "catalog" },
    })) as { models: Model[] };
    const eligible = models.filter((m) => m.supportsImages);
    setModels(eligible);
    setModelId("");
    if (!eligible.length) setError(t("No configured models declare image input."));
  }
  async function recognize() {
    const m = models[Number(modelId)];
    if (!m || modelId === "" || !preview.startsWith("data:image/png;base64,")) return;
    const bytes = Uint8Array.from(atob(preview.slice("data:image/png;base64,".length)), (s) =>
      s.charCodeAt(0),
    );
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const previewSha = Array.from(new Uint8Array(hash), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    const result = (await request({
      kind: "queryModel",
      sceneId,
      action: {
        kind: "recognize",
        provider: m.provider,
        model: m.model,
        input: {
          libraryId,
          assetId,
          digest,
          previewSha,
          previous: pending?.id ?? null,
        },
      },
    })) as { ready?: boolean };
    if (result.ready) refresh();
  }
  async function review(id: string, selected: string[] | null) {
    await request({
      kind: "reviewVision",
      libraryId,
      assetId,
      digest,
      id,
      selected,
      approvedId: approved?.id ?? null,
    });
    refresh();
  }
  const chosen = pending?.labels.filter((label) => !omitted.includes(label)) ?? [];
  return (
    <details>
      <summary>
        {t("Image model labels")}
        {approved && " · " + approved.labels.join("、")}
        {pending && " · " + t("Awaiting review")}
      </summary>
      <p>
        {t(
          "Review one thumbnail and model destination before sending. Saved draft labels can be selected or discarded.",
        )}
      </p>
      <button
        className="ui-button ui-button--sm"
        type="button"
        disabled={busy}
        onClick={() => void act(catalog)}
      >
        {t("Load image models")}
      </button>
      {models.length > 0 && (
        <>
          <select
            className="ui-input"
            aria-label={t("Image model")}
            disabled={busy}
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
          >
            <option value="">{t("Select a model")}</option>
            {models.map((m, i) => (
              <option key={JSON.stringify([m.provider, m.model, m.endpoint])} value={String(i)}>
                {m.provider} · {m.model} · {m.endpoint}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ui-button ui-button--sm"
            disabled={busy || !modelId || !preview}
            onClick={() => void act(recognize)}
          >
            {t("Review thumbnail transfer")}
          </button>
        </>
      )}
      {approved && (
        <div>
          <p>
            {approved.provider} · {approved.model} · {approved.endpointOrigin}{" "}
            {approved.reviewedAt && new Date(approved.reviewedAt * 1000).toLocaleString()}
          </p>
          <button
            type="button"
            className="ui-button ui-button--sm"
            disabled={busy}
            onClick={() => void act(() => review(approved.id, null))}
          >
            {t("Revoke approved model labels")}
          </button>
        </div>
      )}
      {pending && (
        <div>
          <p>
            {pending.provider} · {pending.model} · {pending.endpointOrigin}
          </p>
          <div className="ui-toolbar">
            {pending.labels.map((label) => (
              <label key={label}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={chosen.includes(label)}
                  onChange={(e) =>
                    setOmitted(
                      e.target.checked ? omitted.filter((x) => x !== label) : [...omitted, label],
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <div className="ui-toolbar">
            <button
              type="button"
              className="ui-button ui-button--sm"
              disabled={!chosen.length || busy}
              onClick={() => void act(() => review(pending.id, chosen))}
            >
              {t("Apply selected model labels")}
            </button>
            <button
              type="button"
              className="ui-button ui-button--sm"
              disabled={busy}
              onClick={() => void act(() => review(pending.id, null))}
            >
              {t("Discard suggestions")}
            </button>
          </div>
        </div>
      )}
      {busy && <p role="status">{t("Loading...")}</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
