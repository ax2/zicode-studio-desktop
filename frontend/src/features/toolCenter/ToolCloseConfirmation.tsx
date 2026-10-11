import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { t } from "../../shared/i18n";

export function ToolCloseConfirmation({ title, trigger, busy, onCancel, onConfirm, restoreFocus }: {
  title: string; trigger: HTMLButtonElement; busy: boolean;
  onCancel(): void; onConfirm(): void; restoreFocus(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const fallback = useRef(restoreFocus);
  fallback.current = restoreFocus;
  const label = useId(), description = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    cancel.current?.focus();
    // WebView can finish the opening pointer event after the passive effect.
    const focusFrame = window.requestAnimationFrame(() => { if (element?.open) cancel.current?.focus(); });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      element?.close();
      if (trigger.isConnected) trigger.focus(); else fallback.current();
    };
  }, [trigger]);
  return createPortal(<dialog ref={dialog} className="dialog tool-close-dialog" aria-modal="true" aria-labelledby={label} aria-describedby={description}
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }}>
    <h2 id={label} className="dialog-title">{t("Close tool")}: {title}</h2>
    <p id={description} className="dialog-message">{t("Close this tool and discard its inputs and result?")}</p>
    {busy && <p role="status">{t("Completion unconfirmed")}</p>}
    <div className="ui-toolbar">
      <button ref={cancel} type="button" className="ui-button ui-button--secondary" onClick={onCancel}>{t("Cancel")}</button>
      <button type="button" className="ui-button ui-button--danger" disabled={busy} onClick={onConfirm}>{t("Close tool")}</button>
    </div>
  </dialog>, document.body);
}
