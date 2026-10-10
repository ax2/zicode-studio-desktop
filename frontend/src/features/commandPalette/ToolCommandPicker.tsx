import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import { isImeComposing } from "../../shared/ime";
import { type ManualTool, type ManualToolApi, type ToolDirectoryView, type ToolPage, manualToolError } from "../toolCenter/manual-tools";
import type { ToolAccessScope } from "./tool-access";

export interface ToolCommandSource {
  api: ManualToolApi;
  scope: ToolAccessScope;
  onOpen(tool: ManualTool, revision: string): void;
}

export function ToolCommandPicker({ api, scope, onOpen }: ToolCommandSource) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ToolDirectoryView>("all");
  const [cursor, setCursor] = useState<{ offset: number; revision: string | null; accessRevision?: number | null }>({ offset: 0, revision: null });
  const [page, setPage] = useState<ToolPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setPage(null); setError(""); setSelected(0);
    const timer = setTimeout(() => {
      void api.searchTools(scope.sceneId, { query, ...cursor, view, workspaceId: scope.workspaceId })
        .then(value => { if (active) setPage(value); })
        .catch(reason => { if (active) setError(manualToolError(reason)); })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, scope.sceneId, scope.workspaceId, query, view, cursor]);
  useEffect(() => {
    document.getElementById(`tool-command-${selected}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  function reset() { setPage(null); setLoading(true); setCursor({ offset: 0, revision: null }); }
  function move(offset: number) {
    if (!page || loading) return;
    setLoading(true); setPage(null);
    setCursor({ offset, revision: page.revision, accessRevision: page.accessRevision });
    input.current?.focus();
  }
  function open(index: number) {
    if (!loading && page?.items[index]) onOpen(page.items[index], page.revision);
  }
  return <>
    <input ref={input} className="command-palette-search" type="search" value={query} maxLength={128}
      aria-label={t("Search individual tools")} placeholder={t("Search tool names or uses")}
      role="combobox" aria-expanded="true" aria-controls="tool-command-results"
      aria-activedescendant={!loading && page?.items[selected] ? `tool-command-${selected}` : undefined}
      onChange={event => { setQuery(event.target.value); reset(); }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => {
        if (isImeComposing(event.nativeEvent, composing.current) || loading || !page) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setSelected(index => Math.max(0, Math.min(page.items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        } else if (event.key === "Enter") { event.preventDefault(); open(selected); }
        else if (event.key === "PageDown" && page.nextOffset !== null) { event.preventDefault(); move(page.nextOffset); }
        else if (event.key === "PageUp" && cursor.offset > 0) { event.preventDefault(); move(Math.max(0, cursor.offset - 40)); }
      }} />
    <fieldset className="ui-toolbar command-palette-tabs" aria-label={t("Tool list")}>
      {(["all", "favorites", "recent"] as const).map(value => <button key={value} type="button" className="ui-button ui-button--secondary"
        aria-pressed={view === value} onClick={() => { setView(value); reset(); input.current?.focus(); }}>
        {t(value === "all" ? "All tools" : value === "favorites" ? "Favorite tools" : "Recently used tools")}
      </button>)}
    </fieldset>
    <p className="command-palette-count" role="status" aria-live="polite">{loading ? t("Loading tools…") : page ? t("{count} tools").replace("{count}", String(page.total)) : ""}</p>
    {error && <div role="alert">{t(error)} <button type="button" className="ui-button ui-button--secondary" onClick={reset}>{t("Reload tools")}</button></div>}
    <div id="tool-command-results" className="command-palette-results" role="listbox" aria-label={t("Individual tools")} aria-busy={loading}>
      {!loading && page?.items.map((tool, index) => <button key={tool.toolId} type="button" role="option" id={`tool-command-${index}`}
        aria-selected={selected === index} aria-posinset={cursor.offset + index + 1} aria-setsize={page.total}
        className={`command-item${selected === index ? " selected" : ""}`} onMouseEnter={() => setSelected(index)} onClick={() => open(index)}>
        <span className="command-icon" aria-hidden="true">⌘</span><span className="command-copy">
          <span className="command-label">{tool.title}</span>
          <span className="command-desc">{tool.applicationName} · {tool.version}{tool.enabled ? "" : ` · ${t("Plugin is disabled")}`}</span>
        </span>
      </button>)}
      {!loading && page?.total === 0 && <p className="command-empty">{t("No matching tools")}</p>}
    </div>
    {page && page.total > 40 && <nav className="ui-toolbar" aria-label={t("Tool pages")}>
      <button type="button" className="ui-button ui-button--secondary" disabled={loading || cursor.offset === 0} onClick={() => move(Math.max(0, cursor.offset - 40))}>{t("Previous")}</button>
      <span>{Math.floor(cursor.offset / 40) + 1} / {Math.ceil(page.total / 40)}</span>
      <button type="button" className="ui-button ui-button--secondary" disabled={loading || page.nextOffset === null} onClick={() => move(page.nextOffset ?? 0)}>{t("Next")}</button>
    </nav>}
    <footer className="command-palette-footer">{t("Opening does not execute a tool. Use Enter to open; Esc to cancel.")}</footer>
  </>;
}
