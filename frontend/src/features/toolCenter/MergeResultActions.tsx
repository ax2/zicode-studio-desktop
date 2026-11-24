import { t } from "../../shared/i18n";
import type { MergeSide } from "./data-merge-apply";

export function MergeResultActions({
  enabled,
  current,
  applied,
  left,
  right,
  onApply,
}: {
  enabled: boolean;
  current: boolean;
  applied?: MergeSide;
  left: boolean;
  right: boolean;
  onApply(side: MergeSide): void;
}) {
  if (applied)
    return (
      <p role="status">
        {t(
          applied === "left"
            ? "Applied to the left table as JSON."
            : "Applied to the right table as JSON.",
        )}
      </p>
    );
  return (
    <div className="ui-toolbar">
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={!enabled || !left}
        onClick={() => onApply("left")}
      >
        {t("Apply result to left table")}
      </button>
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={!enabled || !right}
        onClick={() => onApply("right")}
      >
        {t("Apply result to right table")}
      </button>
      {!current ? (
        <span className="tool-center-source">
          {t("The inputs changed. Run the tool again to apply a current result.")}
        </span>
      ) : (
        !left &&
        !right && (
          <span className="tool-center-source">
            {t("This result cannot be applied within the tool’s input contract.")}
          </span>
        )
      )}
    </div>
  );
}
