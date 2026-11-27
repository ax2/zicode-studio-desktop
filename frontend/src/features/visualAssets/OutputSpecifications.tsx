import { t } from "../../shared/i18n";
import type { GenerationOptions } from "./generation-types";

export type ImageSpecifications = {
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
  hasTransparency: boolean;
};

export function OutputSpecifications({
  original,
  requested,
}: {
  original?: ImageSpecifications | null;
  requested: GenerationOptions;
}) {
  if (!original) {
    return <p>{t("Original image specifications could not be read.")}</p>;
  }

  const { width, height, format, hasTransparency } = original;
  const sizeDiffers = requested.size && requested.size !== "auto" &&
    requested.size !== `${width}x${height}`;
  const backgroundDiffers =
    (requested.background === "transparent" && !hasTransparency) ||
    (requested.background === "opaque" && hasTransparency);

  return (
    <>
      <dl aria-label={t("Actual image output")}>
        <dt>{t("Original image size")}</dt>
        <dd>{width} × {height} px</dd>
        <dt>{t("Original file format")}</dt>
        <dd>{format === "webp" ? "WebP" : format.toUpperCase()}</dd>
        <dt>{t("Pixel transparency")}</dt>
        <dd>{t(hasTransparency ? "Contains transparent or translucent pixels" : "All pixels are opaque")}</dd>
      </dl>
      {sizeDiffers && <p>{t("Actual dimensions differ from the requested size.")}</p>}
      {backgroundDiffers && <p>{t("Actual transparency differs from the requested background.")}</p>}
    </>
  );
}
