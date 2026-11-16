import { t } from "../../shared/i18n";
import {
  type GenerationInput,
  generationOptionLabels,
  generationOptionValue,
  type ImageCapabilities,
} from "./generation-types";

export function GenerationFields({
  value,
  capabilities,
  disabled,
  onMode,
  onChange,
}: {
  value: GenerationInput;
  capabilities: ImageCapabilities;
  disabled: boolean;
  onMode: (mode: GenerationInput["mode"]) => void;
  onChange: (value: GenerationInput) => void;
}) {
  const { options } = value;
  return (
    <fieldset disabled={disabled}>
      <legend>{t("Image generation options")}</legend>
      <label>
        {t("Generation mode")}
        <select
          className="ui-select"
          value={value.mode}
          onChange={(event) => onMode(event.target.value as GenerationInput["mode"])}
        >
          <option value="text">{t("Text to image")}</option>
          <option value="image">{t("Image to image")}</option>
        </select>
      </label>
      {capabilities.source === "unlisted" && (
        <p>
          {t(
            "This model has no registered advanced parameters. Only your description and selected reference are sent.",
          )}
        </p>
      )}
      {capabilities.source === "configured" && (
        <p>
          {t(
            "Parameters follow your declared compatibility profile. Verify support with your provider.",
          )}
        </p>
      )}
      {(
        [
          ["size", capabilities.sizes],
          ["quality", capabilities.qualities],
          ["format", capabilities.formats],
          ["background", capabilities.backgrounds],
          ["complexity", capabilities.complexities],
        ] as const
      ).map(
        ([key, choices]) =>
          choices.length > 0 && (
            <label key={key}>
              {t(generationOptionLabels[key])}
              <select
                className="ui-select"
                value={options[key] ?? ""}
                onChange={(event) => {
                  const next = { ...options, [key]: event.target.value || undefined };
                  if (key === "format") {
                    if (next.format === "jpeg" && next.background === "transparent")
                      next.background = "opaque";
                    if (next.format !== "jpeg" && next.format !== "webp") delete next.compression;
                  }
                  onChange({ ...value, options: next });
                }}
              >
                <option value="">{t("Provider default")}</option>
                {choices
                  .filter(
                    (choice) =>
                      key !== "background" || options.format !== "jpeg" || choice !== "transparent",
                  )
                  .map((choice) => (
                    <option key={choice} value={choice}>
                      {t(generationOptionValue(choice))}
                    </option>
                  ))}
              </select>
            </label>
          ),
      )}
      {capabilities.compression && (options.format === "jpeg" || options.format === "webp") && (
        <label>
          {t(generationOptionLabels.compression)}
          <input
            className="ui-input"
            type="number"
            min={0}
            max={100}
            step={1}
            value={options.compression ?? ""}
            onChange={(event) => {
              const next = event.target.value === "" ? undefined : Number(event.target.value);
              if (next === undefined || (Number.isInteger(next) && next >= 0 && next <= 100))
                onChange({ ...value, options: { ...options, compression: next } });
            }}
          />
        </label>
      )}
    </fieldset>
  );
}

export function GenerationSummary({ value }: { value: GenerationInput }) {
  return (
    <>
      <dl>
        {Object.entries(generationOptionLabels)
          .filter(([key]) => value.options[key as keyof GenerationInput["options"]] !== undefined)
          .map(([key, label]) => (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>
                {typeof value.options[key as keyof GenerationInput["options"]] === "string"
                  ? t(
                      generationOptionValue(
                        String(value.options[key as keyof GenerationInput["options"]]),
                      ),
                    )
                  : value.options[key as keyof GenerationInput["options"]]}
              </dd>
            </div>
          ))}
      </dl>
      <p>{t("Unspecified parameters use the provider defaults.")}</p>
    </>
  );
}
