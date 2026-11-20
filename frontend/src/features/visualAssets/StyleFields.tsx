import { t } from "../../shared/i18n";
import { type StyleInput, strengthDescriptions, stylePresets } from "./style-presets";

export function StyleFields({
  value,
  description,
  disabled,
  onChange,
}: {
  value: StyleInput;
  description: string;
  disabled: boolean;
  onChange: (value: StyleInput, description: string) => void;
}) {
  return (
    <fieldset className="ui-card" disabled={disabled}>
      <legend>{t("Style and preserved content")}</legend>
      <label>
        {t("Style preset")}
        <select
          className="ui-select"
          value={value.preset}
          onChange={(event) => {
            const preset = stylePresets.find((entry) => entry.id === event.target.value);
            if (preset)
              onChange(
                { ...value, preset: preset.id, revision: preset.revision },
                t(preset.description),
              );
          }}
        >
          {stylePresets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(preset.title)} · v{preset.revision}
            </option>
          ))}
        </select>
      </label>
      <p>
        {t(
          "Changing the preset replaces the style description. Edit it before reviewing the plan.",
        )}
      </p>
      <label>
        {t("Style description")}
        <textarea
          className="ui-textarea"
          maxLength={4000}
          value={description}
          onChange={(event) => onChange(value, event.target.value)}
        />
      </label>
      <label>
        {t("Style strength")}
        <select
          className="ui-select"
          value={value.strength}
          onChange={(event) => {
            const strength = event.target.value;
            if (strength === "subtle" || strength === "balanced" || strength === "bold")
              onChange({ ...value, strength }, description);
          }}
        >
          <option value="subtle">{t("Subtle")}</option>
          <option value="balanced">{t("Balanced")}</option>
          <option value="bold">{t("Bold")}</option>
        </select>
      </label>
      <p>{t(strengthDescriptions[value.strength])}</p>
      <p>
        {t(
          "Strength is expressed in the prompt, not a native model slider. Results vary by model; review preserved details before saving.",
        )}
      </p>
      <label>
        {t("Content to preserve")}
        <textarea
          className="ui-textarea"
          maxLength={2000}
          value={value.preserve}
          onChange={(event) => onChange({ ...value, preserve: event.target.value }, description)}
        />
      </label>
    </fieldset>
  );
}

export function StyleSummary({ value }: { value: StyleInput }) {
  return (
    <dl>
      <dt>{t("Style preset")}</dt>
      <dd>
        {t(stylePresets.find((preset) => preset.id === value.preset)?.title ?? value.preset)} · v
        {value.revision}
      </dd>
      <dt>{t("Style strength")}</dt>
      <dd>{t(strengthDescriptions[value.strength])}</dd>
      <dt>{t("Content to preserve")}</dt>
      <dd>{value.preserve}</dd>
    </dl>
  );
}
