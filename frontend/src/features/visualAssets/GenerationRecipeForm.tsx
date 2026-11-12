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
  initial?: RecipeDraft;
  disabled: boolean;
  request: CharacterRequest;
  save: (name: string, draft: RecipeDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial ?? empty);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const blocked = disabled || saving;
  const canSave =
    !blocked && draft.identityVersion !== null && (initial !== undefined || name.trim() !== "");

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await save(name, draft);
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
          onChange={(value) => setDraft((current) => ({ ...current, [binding]: value }))}
        />
      ))}
      <label>
        {t("Generation prompt")}
        <textarea
          className="ui-textarea"
          value={draft.prompt}
          maxLength={8000}
          disabled={blocked}
          onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
        />
      </label>
      <label>
        {t("Negative prompt")}
        <textarea
          className="ui-textarea"
          value={draft.negativePrompt}
          maxLength={8000}
          disabled={blocked}
          onChange={(event) => setDraft({ ...draft, negativePrompt: event.target.value })}
        />
      </label>
      <label>
        {t("Generation settings (JSON)")}
        <textarea
          className="ui-textarea"
          value={draft.settingsJson}
          maxLength={16384}
          disabled={blocked}
          onChange={(event) => setDraft({ ...draft, settingsJson: event.target.value })}
        />
      </label>
      <button type="submit" className="ui-button" disabled={!canSave}>
        {t(initial ? "Save recipe version" : "Create generation recipe")}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
