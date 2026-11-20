import type { KeyboardEvent, RefObject } from "react";
import { t } from "../../shared/i18n";
import type { ManualTool } from "./manual-tools";

export function OpenToolTabs({ opened, active, running, strip, selected, onSelect, onClose }: {
  opened: { tool: ManualTool }[]; active: string | null; running: string[];
  strip: RefObject<HTMLFieldSetElement | null>; selected: RefObject<HTMLButtonElement | null>;
  onSelect(id: string | null): void;
  onClose(tool: ManualTool, trigger: HTMLButtonElement): void;
}) {
  function navigate(event: KeyboardEvent<HTMLButtonElement>, tool?: ManualTool) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Delete" && tool && !running.includes(tool.toolId)) {
      event.preventDefault(); onClose(tool, event.currentTarget); return;
    }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...(strip.current?.querySelectorAll<HTMLButtonElement>("[data-open-tool-id]") ?? [])];
    const index = buttons.indexOf(event.currentTarget);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowLeft" ? -1 : 1) + buttons.length) % buttons.length;
    const button = buttons[next];
    onSelect(button.dataset.openToolId || null);
    button.focus({ preventScroll: true });
  }
  return <fieldset ref={strip} className="ui-toolbar tool-open-switcher" aria-label={t("Opened tools")}>
    <button ref={active === null ? selected : undefined} data-open-tool-id="" type="button"
      className="ui-button ui-button--secondary" aria-pressed={active === null} onClick={() => onSelect(null)} onKeyDown={event => navigate(event)}>{t("Tool directory")}</button>
    {opened.map(({ tool }) => <span key={tool.toolId} className="tool-open-item tool-open-tab" data-active={active === tool.toolId}>
      <button type="button" className="ui-button ui-button--ghost" aria-pressed={active === tool.toolId}
        ref={active === tool.toolId ? selected : undefined} data-open-tool-id={tool.toolId} title={tool.title}
        onClick={() => onSelect(tool.toolId)} onKeyDown={event => navigate(event, tool)}><span className="tool-open-title">{tool.title}</span>{running.includes(tool.toolId) ? ` · ${t("Completion unconfirmed")}` : ""}</button>
      <button type="button" className="ui-icon-button ui-icon-button--sm ui-icon-button--ghost tool-tab-close"
        aria-label={`${t("Close tool")}: ${tool.title}`} title={t("Close tool")} disabled={running.includes(tool.toolId)}
        onClick={event => onClose(tool, event.currentTarget)}><span aria-hidden="true">×</span></button>
    </span>)}
  </fieldset>;
}
