import { t } from "../../shared/i18n";
import type { CapabilityProfile } from "./generation-types";

export function ImageCapabilitySettings({
  value,
  onChange,
}: {
  value?: CapabilityProfile;
  onChange: (value?: CapabilityProfile) => void;
}) {
  return (
    <>
      <label>
        {t("Image API compatibility")}
        <select
          className="ui-select"
          value={value ?? ""}
          onChange={(event) =>
            onChange((event.target.value || undefined) as CapabilityProfile | undefined)
          }
        >
          <option value="">{t("Use registered model capabilities")}</option>
          <option value="basic-v1">{t("Basic Images API — provider defaults")}</option>
          <option value="gpt-image-v1">{t("Declare GPT Image parameter support")}</option>
          <option value="gpt-image-26-v1">{t("Declare GPT Image 2.6 parameter support")}</option>
        </select>
      </label>
      <p>
        {t(
          "Only declare a compatibility profile supported by your provider. This does not test model availability.",
        )}
      </p>
    </>
  );
}
