import { useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { ContextPackRequest, PrepareContextPack } from "./knowledge-chat";

export function ContextPackButton({
  request,
  prepare,
  disabled = false,
}: {
  request: ContextPackRequest;
  prepare: PrepareContextPack;
  disabled?: boolean;
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
    <>
      <button
        type="button"
        className="ui-button ui-button--secondary ui-button--sm"
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={() => void handoff()}
      >
        {t(request.compare ? "Compare in chat" : "Use context pack")}
      </button>
      {failed ? <p role="alert">{t("Could not prepare the note context draft")}</p> : null}
    </>
  );
}
