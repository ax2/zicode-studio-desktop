import { t } from "../../shared/i18n";

export type ImageUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  textInputTokens?: number | null;
  imageInputTokens?: number | null;
  textOutputTokens?: number | null;
  imageOutputTokens?: number | null;
  elapsedMs?: number | null;
};

const fields = [
  ["inputTokens", "Input tokens"],
  ["textInputTokens", "Text input tokens"],
  ["imageInputTokens", "Image input tokens"],
  ["outputTokens", "Output tokens"],
  ["textOutputTokens", "Text output tokens"],
  ["imageOutputTokens", "Image output tokens"],
  ["totalTokens", "Total tokens"],
] as const;

function count(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function OutfitUsage({ usage }: { usage?: ImageUsage | null }) {
  const rows = fields.filter(([key]) => count(usage?.[key]));
  return (
    <>
      {count(usage?.elapsedMs) && (
        <p>
          {t("Elapsed seconds")} · {(usage.elapsedMs / 1000).toFixed(1)}
        </p>
      )}
      <p>{t("Provider cost is unknown. Check your provider's usage records.")}</p>
      {rows.length > 0 && (
        <details>
          <summary>{t("Provider usage details")}</summary>
          <p>{t("Reported usage only. Missing values are not zero; this is not a bill.")}</p>
          <dl>
            {rows.map(([key, label]) => (
              <div key={key}>
                <dt>{t(label)}</dt>
                <dd>{usage?.[key]}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}
