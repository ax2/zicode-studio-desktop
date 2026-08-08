import { computeContextViz, formatTokens, type UsageLike } from "./contextUsageLogic";
import { t } from "../../shared/i18n";

export function TokenUsagePill({
  text,
}: {
  text: string;
}) {
  return <>{text}</>;
}

export function ContextVizApp({
  usage,
  contextWindowSize,
}: {
  usage: UsageLike | null;
  contextWindowSize: number;
}) {
  const model = computeContextViz(usage, contextWindowSize);
  if (!model) {
    return (
      <>
        <div className="context-viz-title">{t("Context Window")}</div>
        <p className="context-viz-empty">{t("No usage data yet")}</p>
      </>
    );
  }
  return (
    <>
      <div className="context-viz-title">{t("Context Window")}</div>
      <div className="context-bar" id="context-bar">
        {model.segments
          .filter((segment) => segment.tokens > 0)
          .map((segment) => (
            <div
              key={segment.key}
              className={`context-bar-segment ${segment.color}`}
              style={{ width: `${(segment.tokens / model.total) * 100}%` }}
              title={`${segment.label}: ${formatTokens(segment.tokens)}`}
            />
          ))}
      </div>
      <div className="context-legend" id="context-legend">
        {model.segments.map((segment) => (
          <div key={segment.key} className="context-legend-item">
            <span className="context-legend-left">
              <span className={`context-legend-dot ${segment.color}`} />
              {segment.label}
            </span>
            <span className="context-legend-value">
              {formatTokens(segment.tokens)}
            </span>
          </div>
        ))}
      </div>
      <div className="context-viz-footer">
        <span id="context-viz-used">{model.percent}% used</span>
        <span id="context-viz-total">
          {formatTokens(model.totalUsed)} / {formatTokens(model.total)}
        </span>
      </div>
    </>
  );
}
