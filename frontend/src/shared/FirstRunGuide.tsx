import { useEffect, useState } from "react";
import { t } from "./i18n";

const DISMISS_PREFIX = "zicode.first-run.dismissed.";

function readDismissed(storageKey: string, storage: Storage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(DISMISS_PREFIX + storageKey) === "1";
  } catch {
    return false;
  }
}

/**
 * A compact first-visit guide card. Shows the app's usage loop (what it is,
 * the first action, where results go) and offers a primary call-to-action.
 * Dismissing persists per app so regular users never see it again.
 */
export function FirstRunGuide({
  storageKey,
  title,
  steps,
  ctaLabel,
  onCta,
  storage = globalThis.localStorage,
}: {
  storageKey: string;
  title: string;
  steps: string[];
  ctaLabel: string;
  onCta: () => void;
  storage?: Storage | null;
}) {
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey, storage));
  useEffect(() => {
    setDismissed(readDismissed(storageKey, storage));
  }, [storageKey, storage]);
  if (dismissed || steps.length === 0) return null;

  const dismiss = () => {
    try {
      storage?.setItem(DISMISS_PREFIX + storageKey, "1");
    } catch {
      // Persistence is optional.
    }
    setDismissed(true);
  };

  return (
    <section className="first-run-guide ui-card" data-first-run-guide>
      <div className="first-run-guide-copy">
        <h2>{title}</h2>
        <ol>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <div className="first-run-guide-actions">
        <button
          type="button"
          className="ui-button ui-button--primary ui-button--sm"
          onClick={() => {
            onCta();
            dismiss();
          }}
        >
          {ctaLabel}
        </button>
        <button
          type="button"
          className="ui-button ui-button--ghost ui-button--sm"
          onClick={dismiss}
        >
          {t("Got it")}
        </button>
      </div>
    </section>
  );
}
