import { useEffect, useRef } from "react";
import { t } from "../../shared/i18n";
import { startupFailureCopy } from "./startupFailureLogic";

export function StartupFailureApp({
  code,
  onReload,
}: {
  code: string;
  onReload(): void;
}) {
  const copy = startupFailureCopy(code);
  const retryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    retryRef.current?.focus();
  }, []);

  return (
    <main
      className="startup-failure"
      data-startup-failure={code}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="startup-failure-title"
      aria-live="assertive"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        retryRef.current?.focus();
      }}
    >
      <section className="startup-failure-card">
        <div className="startup-failure-mark" aria-hidden="true">
          !
        </div>
        <h1 id="startup-failure-title">{t(copy.title)}</h1>
        <p>{t(copy.message)}</p>
        <p className="startup-failure-guidance">{t(copy.guidance)}</p>
        <button
          ref={retryRef}
          type="button"
          className="ui-button ui-button--primary"
          onClick={onReload}
        >
          {t("Retry")}
        </button>
      </section>
    </main>
  );
}
