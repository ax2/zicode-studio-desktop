import { useState } from "react";
import { t } from "../../shared/i18n";
import type { ImageCapabilities } from "./generation-types";
import { ImageCapabilitySettings } from "./ImageCapabilitySettings";
import { type CreationRequest, type ImageSettings, outfitError } from "./outfit-types";
export function ImageModelSettings({
  settings,
  configured,
  request,
  disabled,
  onSaved,
  onBusyChange,
  onEdit,
  generation = false,
}: {
  settings: ImageSettings;
  configured: boolean;
  request: CreationRequest;
  disabled: boolean;
  onSaved: (value: {
    settings: ImageSettings;
    credentialConfigured: boolean;
    capabilities?: ImageCapabilities;
  }) => void;
  onBusyChange: (busy: boolean) => void;
  onEdit: () => void;
  generation?: boolean;
}) {
  const [draft, setDraft] = useState(settings);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save() {
    if (busy || disabled) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setSaved(false);
    try {
      const value = (await request({
        kind: "saveSettings",
        settings: draft,
        apiKey: key || null,
      })) as {
        settings: ImageSettings;
        credentialConfigured: boolean;
        capabilities?: ImageCapabilities;
      };
      setKey("");
      setSaved(true);
      onSaved(value);
    } catch (reason) {
      setError(t(outfitError(reason)));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <details className="ui-card" open={!settings.model}>
      <summary>{t("Image model settings")}</summary>
      <p>
        {t(
          "Use an OpenAI Images-compatible endpoint. Availability depends on the provider and model.",
        )}
      </p>
      <form
        onChange={() => {
          setSaved(false);
          onEdit();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={disabled || busy}>
          <label>
            {t("Image API base URL")}
            <input
              className="ui-input"
              required
              type="url"
              maxLength={2048}
              value={draft.baseUrl}
              onChange={(event) =>
                setDraft({ ...draft, baseUrl: event.target.value, capabilityProfile: undefined })
              }
            />
          </label>
          <label>
            {t("Image model ID")}
            <input
              className="ui-input"
              required
              maxLength={256}
              value={draft.model}
              onChange={(event) =>
                setDraft({ ...draft, model: event.target.value, capabilityProfile: undefined })
              }
              placeholder="gpt-image-2.6-sunburst"
            />
          </label>
          {generation && (
            <ImageCapabilitySettings
              value={draft.capabilityProfile}
              onChange={(value) => setDraft({ ...draft, capabilityProfile: value })}
            />
          )}
          <label>
            <input
              type="checkbox"
              checked={draft.requiresKey}
              onChange={(event) => setDraft({ ...draft, requiresKey: event.target.checked })}
            />
            {t("Endpoint requires an API key")}
          </label>
          {draft.requiresKey && (
            <label>
              {t("API key (stored on this computer)")}
              <input
                className="ui-input"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
          )}
          <p>
            {t(
              configured && draft.baseUrl === settings.baseUrl
                ? "A key is configured for this endpoint."
                : "A different endpoint needs its own API key.",
            )}
          </p>
          {!generation && (
            <>
              <label>
                {t("Image size")}
                <select
                  className="ui-select"
                  value={draft.size}
                  onChange={(event) => setDraft({ ...draft, size: event.target.value })}
                >
                  {["auto", "1024x1024", "1536x1024", "1024x1536"].map((size) => (
                    <option key={size} value={size}>
                      {size === "auto" ? t("Automatic") : size}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Image quality")}
                <select
                  className="ui-select"
                  value={draft.quality}
                  onChange={(event) => setDraft({ ...draft, quality: event.target.value })}
                >
                  {[
                    ["auto", "Automatic"],
                    ["low", "Low"],
                    ["medium", "Medium"],
                    ["high", "High"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <button type="submit" className="ui-button" disabled={!draft.model.trim()}>
            {t("Save image model settings")}
          </button>
        </fieldset>
      </form>
      {saved && <p role="status">{t("Image model settings saved.")}</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
