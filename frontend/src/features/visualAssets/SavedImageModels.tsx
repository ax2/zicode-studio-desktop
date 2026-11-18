import { useState } from "react";
import { t } from "../../shared/i18n";
import type { ImageCapabilities } from "./generation-types";
import { type CreationRequest, type ImageSettings, outfitError } from "./outfit-types";

type Profile = { id: string; name: string; settings: ImageSettings };
type Saved = { settings: ImageSettings; credentialConfigured: boolean; capabilities?: ImageCapabilities; selectedProfileId?: string | null };
export function SavedImageModels({ settings, apiKey, request, disabled, onSaved, onEdit, onBusyChange }: {
  settings: ImageSettings; apiKey: string; request: CreationRequest; disabled: boolean;
  onSaved: (value: Saved) => void; onEdit: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  async function read() {
    const value = await request({ kind: "modelProfiles" }) as { profiles: Profile[]; selectedProfileId: string | null };
    if (!Array.isArray(value?.profiles)) throw new Error("visual_assets_model_profiles_unavailable");
    setProfiles(value.profiles); setSelected(value.selectedProfileId ?? ""); setLoaded(true);
  }
  async function run(action?: Record<string, unknown>) {
    if (busy || disabled) return;
    setBusy(true); onBusyChange(true); setError("");
    if (action) onEdit();
    try {
      if (action) {
        const value = await request(action) as Saved;
        if (!value?.settings) throw new Error("visual_assets_model_profiles_unavailable");
        onSaved(value); setSelected(value.selectedProfileId ?? "");
        if (action.kind === "saveModelProfile") setName("");
      }
      await read();
    } catch (reason) { setError(t(outfitError(reason))); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="ui-card" aria-label={t("Saved image models")}>
    <h3>{t("Saved image models")}</h3>
    <p>{t("Save several image model configurations and switch between them. Previous settings, images and tasks are retained.")}</p>
    <p>{t("Models at the same image API address share its image credential. Chat credentials are separate.")}</p>
    <fieldset disabled={busy || disabled}>
      <div className="ui-toolbar">
        <label>{t("Active image model")}
          <select className="ui-select" value={selected} disabled={!loaded} onChange={event => {
            if (event.target.value) void run({ kind: "selectModelProfile", id: event.target.value });
          }}>
            <option value="">{t("Current manual settings")}</option>
            {profiles.map(profile => <option key={profile.id} value={profile.id} translate="no">{profile.name} — {profile.settings.model}</option>)}
          </select>
        </label>
        <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => void run()}>{t("Load saved models")}</button>
        <button type="button" className="ui-button ui-button--ghost ui-button--sm" disabled={!selected} onClick={() => {
          if (globalThis.confirm(t("Remove this saved model entry? Current settings, credentials, images and tasks are kept."))) {
            void run({ kind: "removeModelProfile", id: selected, confirmed: true });
          }
        }}>{t("Remove saved model")}</button>
      </div>
      <form onSubmit={event => {
        event.preventDefault();
        void run({ kind: "saveModelProfile", name: name.trim(), settings, apiKey: apiKey || null });
      }}>
        <label>{t("Saved model name")}
          <input className="ui-input" maxLength={80} value={name} onChange={event => setName(event.target.value)} />
        </label>
        <button type="submit" className="ui-button ui-button--secondary ui-button--sm" disabled={!name.trim() || !settings.model.trim()}>{t("Save and use this model")}</button>
      </form>
    </fieldset>
    {busy && <p role="status">{t("Updating model settings…")}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
