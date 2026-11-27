import { useState } from "react";
import { t } from "../../shared/i18n";
import { type Binding, RecipeInputPicker } from "./RecipeInputPicker";
import type { CharacterRequest } from "./useCharacterRecords";

export interface RecipeDraft {
  identityVersion: number | null;
  appearanceVersion: number | null;
  styleVersion: number | null;
  referenceSetId: number | null;
  prompt: string;
  negativePrompt: string;
  settingsJson: string;
}

export type RecipeVersion = { version: number; draft: RecipeDraft };

const empty: RecipeDraft = {
  identityVersion: null,
  appearanceVersion: null,
  styleVersion: null,
  referenceSetId: null,
  prompt: "",
  negativePrompt: "",
  settingsJson: "{}",
};
const bindings: Binding[] = [
  "identityVersion",
  "appearanceVersion",
  "styleVersion",
  "referenceSetId",
];

export function GenerationRecipeForm({
  id,
  initial,
  disabled,
  request,
  save,
}: {
  id: string;
  initial?: RecipeVersion;
  disabled: boolean;
  request: CharacterRequest;
  save: (name: string, draft: RecipeDraft, previous: number | null) => Promise<number | undefined>;
}) {
  const [edit, setEdit] = useState<{ draft: RecipeDraft; baseVersion: number | null } | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const version = initial?.version ?? null;
  const draft = edit?.draft ?? initial?.draft ?? empty;
  const baseVersion = edit ? edit.baseVersion : version;
  const staleDraft = baseVersion !== version;
  const newerVersion = baseVersion !== null && version !== null && version > baseVersion;
  const blocked = disabled || saving;
  const canSave =
    !blocked && !staleDraft && draft.identityVersion !== null &&
    (initial !== undefined || name.trim() !== "");

  function change(values: Partial<RecipeDraft>) {
    setEdit((previous) => ({
      draft: { ...(previous?.draft ?? initial?.draft ?? empty), ...values },
      baseVersion: previous ? previous.baseVersion : version,
    }));
  }

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const savedVersion = await save(name, draft, baseVersion);
      if (savedVersion !== undefined) setEdit({ draft, baseVersion: savedVersion });
    } catch (reason) {
      const code = String(reason);
      setError(
        t(
          code.includes("visual_assets_recipe_settings_invalid")
            ? "Enter generation settings as a JSON object within 16 KB."
            : code.includes("visual_assets_recipe_version_changed")
              ? "The latest version changed. Review it before saving again."
              : code.includes("visual_assets_recipe_inputs_invalid")
                ? "One of the selected inputs is unavailable."
                : "Could not save the generation recipe.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="ui-card"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {!initial && (
        <label>
          {t("Recipe name")}
          <input
            className="ui-input"
            value={name}
            required
            maxLength={80}
            disabled={blocked}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      )}
      {bindings.map((binding) => (
        <RecipeInputPicker
          key={binding}
          id={id}
          binding={binding}
          value={draft[binding]}
          request={request}
          disabled={blocked}
          onChange={(value) => change({ [binding]: value })}
        />
      ))}
      <label>
        {t("Generation prompt")}
        <textarea
          className="ui-textarea"
          value={draft.prompt}
          maxLength={8000}
          disabled={blocked}
          onChange={(event) => change({ prompt: event.target.value })}
        />
      </label>
      <label>
        {t("Negative prompt")}
        <textarea
          className="ui-textarea"
          value={draft.negativePrompt}
          maxLength={8000}
          disabled={blocked}
          onChange={(event) => change({ negativePrompt: event.target.value })}
        />
      </label>
      <label>
        {t("Generation settings (JSON)")}
        <textarea
          className="ui-textarea"
          value={draft.settingsJson}
          maxLength={16384}
          disabled={blocked}
          onChange={(event) => change({ settingsJson: event.target.value })}
        />
      </label>
      <button type="submit" className="ui-button" disabled={!canSave}>
        {t(initial ? "Save recipe version" : "Create generation recipe")}
      </button>
      {newerVersion && (
        <div>
          <p role="status">{t("The latest version changed. Review it before saving again.")}</p>
          <button
            type="button"
            className="ui-button"
            disabled={blocked}
            onClick={() => {
              setEdit(null);
              setError("");
            }}
          >
            {t("Load latest version into editor")}
          </button>
        </div>
      )}
      {error && !newerVersion && <p role="alert">{error}</p>}
    </form>
  );
}
