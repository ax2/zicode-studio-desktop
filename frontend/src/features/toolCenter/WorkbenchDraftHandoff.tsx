import { useId, useLayoutEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import {
  type OpenWorkbenchDraft,
  type WorkbenchDraftReceiver,
  type WorkbenchTableMaterial,
  workbenchDraftReceivers,
} from "./workbench-draft-handoff";

export function WorkbenchDraftHandoff({
  sourceId,
  material,
  onOpen,
}: {
  sourceId: string;
  material: WorkbenchTableMaterial;
  onOpen: OpenWorkbenchDraft;
}) {
  const label = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const active = useRef(true);
  const confirming = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choices = workbenchDraftReceivers.filter((choice) => !sourceId.endsWith("." + choice.id));
  const [receiver, setReceiver] = useState<WorkbenchDraftReceiver>(choices[0].id);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function confirm() {
    if (confirming.current) return;
    confirming.current = true;
    setBusy(true);
    setError("");
    try {
      await onOpen(
        receiver,
        { text: material.text, format: material.format },
        () => active.current,
      );
      if (active.current) setSelecting(false);
    } catch (reason) {
      if (active.current)
        setError(
          reason instanceof Error && reason.message === "workbench_receiver_open"
            ? "That tool already has an open tab. Close it or choose another receiver."
            : reason instanceof Error && reason.message === "tool_tabs_full"
              ? "Close an opened tool before opening another."
              : "Could not open a receiving draft. Check the tool and try again.",
        );
    } finally {
      confirming.current = false;
      if (active.current) setBusy(false);
    }
  }

  if (!selecting)
    return (
      <button
        ref={trigger}
        type="button"
        className="ui-button ui-button--secondary"
        onClick={() => {
          setError("");
          setSelecting(true);
        }}
      >
        {t("Send result as table draft…")}
      </button>
    );
  return (
    <section className="ui-panel" aria-labelledby={label}>
      <p id={label} className="tool-center-source">
        {t("{format} table · {bytes} bytes. The receiving tool opens with an editable draft.")
          .replace("{format}", material.format.toUpperCase())
          .replace("{bytes}", String(new TextEncoder().encode(material.text).length))}
      </p>
      <label className="tool-input-field">
        {t("Receiving tool")}
        <select
          className="ui-select"
          value={receiver}
          disabled={busy}
          onChange={(event) => {
            const selected = choices.find((choice) => choice.id === event.target.value);
            if (selected) setReceiver(selected.id);
          }}
        >
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {t(choice.title)}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{t(error)}</p>}
      <div className="ui-toolbar">
        <button
          type="button"
          className="ui-button ui-button--secondary"
          disabled={busy}
          onClick={() => {
            setSelecting(false);
            window.requestAnimationFrame(() => trigger.current?.focus());
          }}
        >
          {t("Cancel")}
        </button>
        <button
          type="button"
          className="ui-button ui-button--primary"
          disabled={busy}
          onClick={() => {
            void confirm();
          }}
        >
          <span key={String(busy)}>{t(busy ? "Opening…" : "Open receiving draft")}</span>
        </button>
      </div>
    </section>
  );
}
