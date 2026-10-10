import { type ReactNode, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { ManagedPlugin } from "./pluginManagerLogic";

const PAGE_SIZE = 40;

export function PluginCatalog({ plugins, renderCard, empty }: {
  plugins: ManagedPlugin[];
  renderCard(plugin: ManagedPlugin): ReactNode;
  empty: ReactNode;
}) {
  const [requestedPage, setRequestedPage] = useState(1);
  const [draft, setDraft] = useState<string | null>(null);
  const navigation = useRef<HTMLElement>(null);
  const pages = Math.max(1, Math.ceil(plugins.length / PAGE_SIZE));
  const page = Math.min(requestedPage, pages);
  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, plugins.length);
  const move = (next: number) => {
    setRequestedPage(Math.max(1, Math.min(pages, next)));
    setDraft(null);
    navigation.current?.scrollIntoView?.({ block: "nearest" });
  };
  const commit = () => {
    if (draft !== null && /^\d+$/.test(draft)) move(Number(draft));
    else setDraft(null);
  };

  return (
    <>
      {pages > 1 && (
        <nav className="plugin-manager-pagination" aria-label={t("Plugin catalog pages")} ref={navigation}>
          <button type="button" className="ui-button ui-button--sm ui-button--secondary"
            disabled={page === 1} onClick={() => move(page - 1)}>{t("Previous page")}</button>
          <label htmlFor="plugin-catalog-page">{t("Page")}</label>
          <input id="plugin-catalog-page" className="ui-input" type="number" min={1} max={pages}
            value={draft ?? page} onChange={event => setDraft(event.target.value)} onBlur={commit}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }} />
          <span>{`/ ${pages}`}</span>
          <button type="button" className="ui-button ui-button--sm ui-button--secondary"
            disabled={page === pages} onClick={() => move(page + 1)}>{t("Next page")}</button>
          <span role="status" aria-live="polite">{t("Showing {start}–{end} of {total}")
            .replace("{start}", String(start + 1)).replace("{end}", String(end)).replace("{total}", String(plugins.length))}</span>
        </nav>
      )}
      <div className="plugin-manager-grid">
        {plugins.length ? plugins.slice(start, end).map(renderCard) : empty}
      </div>
    </>
  );
}
