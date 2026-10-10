import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { ManualToolDetailView, type ManualToolDetailProps } from "./ManualToolDetail";
import { ToolFailureBoundary } from "./ToolFailureBoundary";
import { useManualToolCall } from "./use-manual-tool-call";
import { ResourceSessionOwner } from "./resource-session-owner";

// Keep the invocation controller alive when only the tool's rendered detail fails.
export function ManualToolSession({ onDirectory, onBusy, ...props }: ManualToolDetailProps & { onDirectory(): void }) {
  const call = useManualToolCall(props.api, props.tool.runtime);
  const [failed, setFailed] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resourceSession] = useState(() => new ResourceSessionOwner(setResourceBusy));
  const callback = useRef(onBusy);
  callback.current = onBusy;
  useEffect(() => { callback.current?.(call.busy || resourceBusy || (!failed && detailBusy)); }, [call.busy, resourceBusy, failed, detailBusy]);
  useEffect(() => () => resourceSession.destroy(), [resourceSession]);
  useEffect(() => {
    if (!failed || !(call.busy || resourceBusy)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [failed, call.busy, resourceBusy]);
  const notice = call.notice || (call.phase === "cancelled" ? "Tool cancelled. No result was kept."
    : call.phase === "completed" || call.phase === "failed" ? "The tool ended, but its response is unavailable. Check before running it again."
    : call.busy ? "Connection interrupted. The tool may still be running. Check its status before retrying." : "");
  return <ToolFailureBoundary onFailure={() => setFailed(true)} onDirectory={onDirectory}
    recovery={<>
      {notice && <p role="status" key={notice}>{t(notice)}</p>}
      <div ref={view => resourceSession.showFallback(view)} />
      {call.supported && call.busy && <div className="ui-toolbar">
        <button type="button" className="ui-button ui-button--danger" disabled={call.phase === "preparing" || call.phase === "cancelling"}
          onClick={() => { void call.cancel(); }}><span key={call.phase}>{t(call.phase === "cancelling" ? "Cancelling…" : "Cancel tool")}</span></button>
        <button type="button" className="ui-button ui-button--secondary" disabled={call.phase === "preparing"}
          onClick={() => { void call.checkStatus(); }}>{t("Check tool status")}</button>
      </div>}
    </>}>
    <ManualToolDetailView {...props} call={call} onBusy={setDetailBusy} resourceSession={resourceSession} />
  </ToolFailureBoundary>;
}
