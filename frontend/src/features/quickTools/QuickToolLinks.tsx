import { isWorkspaceEntryVisible } from "../../shared/workspaceMode";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { t } from "../../shared/i18n";
import { useQuickToolMenu } from "./use-quick-tool-menu";

interface QuickTool { id: string; title: string }
export function QuickToolLinks({ compact = false }: { compact?: boolean }) {
  const [tools, setTools] = useState<QuickTool[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const menu = useQuickToolMenu(compact);
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setTools(detail.items.filter((item: QuickTool) => isWorkspaceEntryVisible(item.id)));
      setError(Boolean(detail.error));
      setLoading(Boolean(detail.loading));
    };
    window.addEventListener("zicode:quick-tools-changed", update);
    window.dispatchEvent(new Event("zicode:quick-tools-request"));
    return () => window.removeEventListener("zicode:quick-tools-changed", update);
  }, []);
  const content = <>
    <div className="quick-tool-links">
      <button type="button" className="ui-button ui-button--secondary" data-quick-translation aria-keyshortcuts="Control+Shift+Y Meta+Shift+Y" title={t("Translate (Ctrl+Shift+Y)")} onClick={() => { menu.dismiss(); window.dispatchEvent(new Event("zicode:open-translation")); }}>{t("Translate")}</button>
      {tools.map(tool => <button key={tool.id} type="button" className="ui-button ui-button--secondary"
        data-quick-tool-id={tool.id} title={tool.title} onClick={() => {
          menu.dismiss();
          window.dispatchEvent(new CustomEvent("zicode:open-quick-tool", { detail: tool.id }));
        }}><span>{tool.title}</span></button>)}
    </div>
    {!tools.length && <p className="ui-muted" role="status">{t(loading ? "Loading tools…" : error ? "Quick tools unavailable. Try again." : "Favorite tools to add them here and to the tray menu.")}</p>}
    {error && <button type="button" className="ui-button ui-button--secondary" onClick={() => {
      window.dispatchEvent(new Event("zicode:quick-tools-retry"));
    }}>{t("Retry quick tools")}</button>}
    <button type="button" className="ui-button ui-button--ghost" onClick={() => {
      menu.dismiss();
      window.dispatchEvent(new Event("zicode:manage-quick-tools"));
    }}>{t("Choose quick tools")}</button>
  </>;
  return compact ? <details ref={menu.ref} className="quick-tools-menu"><summary className="ui-icon-button ui-icon-button--sm ui-icon-button--ghost" title={t("Quick tools")} aria-label={t("Quick tools")}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m13 3-9 11h7l-1 7 10-12h-7l1-6Z" /></svg>
  </summary>
    <div className="quick-tools-popover ui-panel">{content}</div></details>
    : <section className="welcome-quick-tools" aria-label={t("Quick tools")}><h2>{t("Quick tools")}</h2>{content}</section>;
}

export function mountQuickTools(container: HTMLElement) {
  const root = createRoot(container);
  root.render(<QuickToolLinks compact />);
  return { destroy: () => root.unmount() };
}
