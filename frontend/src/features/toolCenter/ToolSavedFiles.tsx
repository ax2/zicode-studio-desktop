import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../shared/i18n";
import { SavedOutputs } from "../artifacts/SavedOutputs";
import type { SavedOutputGateway } from "../artifacts/saved-output-types";
import type { ToolAccessScope } from "../commandPalette/tool-access";

function SavedFilesDialog({ gateway, scope, trigger, onClose }: {
  gateway: SavedOutputGateway; scope: ToolAccessScope;
  trigger: HTMLButtonElement | null; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  const { sceneId, workspaceId } = scope;
  const getTarget = useCallback(() => ({ sceneId, workspaceId }), [sceneId, workspaceId]);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const focus = () => element?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    focus();
    const frame = requestAnimationFrame(focus);
    const leaveTools = () => { if (document.body.dataset.activePlugin !== "core.tools") onClose(); };
    document.addEventListener("zicode:active-plugin-changed", leaveTools);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("zicode:active-plugin-changed", leaveTools);
      element?.close();
      if (trigger?.isConnected && !trigger.closest("[hidden]")) trigger.focus({ preventScroll: true });
    };
  }, [onClose, trigger]);
  return createPortal(<dialog ref={dialog} className="dialog saved-tool-files-dialog" aria-labelledby={label}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="saved-tool-files-heading">
      <h2 id={label} className="dialog-title">{t("Saved tool files")}</h2>
      <button type="button" className="ui-button ui-button--secondary" onClick={onClose}>{t("Close")}</button>
    </header>
    <SavedOutputs gateway={gateway} getTarget={getTarget} expanded />
  </dialog>, document.body);
}

export function ToolSavedFiles({ gateway, scope }: { gateway: SavedOutputGateway; scope: ToolAccessScope }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button ref={trigger} type="button" className="ui-button ui-button--secondary" aria-haspopup="dialog"
      onClick={() => setOpen(true)}>{t("Saved files")}</button>
    {open && <SavedFilesDialog gateway={gateway} scope={scope} trigger={trigger.current} onClose={close} />}
  </>;
}
