import { useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { PrepareRunAnalysis, RunAnalysisRequest } from "./run-analysis";

export function RunAnalysisButton({
  request,
  prepare,
}: {
  request: RunAnalysisRequest;
  prepare: PrepareRunAnalysis;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function handoff() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailed(false);
    try {
      await prepare(request);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div>
      <p>
        {t(
          "Prepare this displayed run and its available output in chat. The existing draft is preserved; check and send it yourself.",
        )}
      </p>
      {failed ? <p role="alert">{t("Could not prepare the run analysis draft")}</p> : null}
      <button
        type="button"
        className="ui-button ui-button--secondary"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void handoff()}
      >
        {t("Analyze run in chat")}
      </button>
    </div>
  );
}
