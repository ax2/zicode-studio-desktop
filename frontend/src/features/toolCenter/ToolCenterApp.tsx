import { useEffect, useMemo, useState } from "react";
import { matchesSearchTerms, prepareSearchQuery } from "../../shared/catalog-search";
import { t } from "../../shared/i18n";
import type { PaletteCommand } from "../commandPalette/commandPaletteLogic";
import { accessCommands, type ToolAccessScope, type ToolAccessStore } from "../commandPalette/tool-access";
import { useToolAccess } from "../commandPalette/use-tool-access";
import { ManualToolDirectory } from "./ManualToolDirectory";
import type { ManualToolApi, ToolOpenRequest } from "./manual-tools";
import type { ResourceTargetProvider } from "./ResourceToolRunner";
import { ResourceCallRecords } from "./ResourceCallRecords";
import { ToolWorkspacePicker, type ToolWorkspaceApi } from "./ToolWorkspacePicker";
import { initialTrayToolView, subscribeTrayToolView } from "./tray-tool-view";

export interface ApplicationEntry extends PaletteCommand { category: string; source: string }
export interface ToolCenterProps {
  entries: ApplicationEntry[];
  accessStore?: ToolAccessStore;
  scope?: ToolAccessScope;
  toolApi?: ManualToolApi;
  catalogRevision?: number;
  requestedTool?: ToolOpenRequest;
  getResourceTarget?: ResourceTargetProvider;
  onOpen(entry: ApplicationEntry): void;
  onManage(): void;
  onCommands(): void;
  workspaceApi?: ToolWorkspaceApi;
}

export function ToolCenterApp({ entries, accessStore, scope, toolApi, catalogRevision, requestedTool, getResourceTarget, onOpen, onManage, onCommands, workspaceApi }: ToolCenterProps) {
  const [section, setSection] = useState(toolApi && scope ? "tools" : "applications");
  useEffect(() => { if (requestedTool) setSection("tools"); }, [requestedTool]);
  const [query, setQuery] = useState("");
  const [view, setView] = useState(initialTrayToolView);
  useEffect(() => subscribeTrayToolView(next => { setView(next); setPage(0); }), []);
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const access = useToolAccess(accessStore, scope);
  const categories = [...new Set(entries.map(entry => entry.category))];
  const filtered = useMemo(() => {
    const terms = prepareSearchQuery(query);
    const ids = new Set(accessCommands(entries, access.state, view).map(entry => entry.id));
    const visible = entries.filter(entry => ids.has(entry.id) && (!category || category === entry.category) &&
      matchesSearchTerms(terms, [entry.label, entry.desc, t(entry.category), entry.source, ...(entry.keywords ?? [])]));
    if (view === "recent") {
      const order = new Map(access.state.recent.map((entry, index) => [entry.id, index]));
      visible.sort((a, b) => (order.get(a.id ?? "") ?? 0) - (order.get(b.id ?? "") ?? 0));
    }
    return visible;
  }, [entries, access.state, view, category, query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 40) - 1));
  const missing = access.state.favorites.filter(id => id.endsWith(":open") && !entries.some(entry => entry.id === id));
  const busy = access.loading || access.pending || access.error;
  return <section className="tool-center" aria-labelledby="tool-center-title">
    <header className="tool-center-header">
      <div><h1 id="tool-center-title">{t("Applications and tools")}</h1>
        <p>{t("Find a tool or an application. Opening does not execute a tool.")}</p></div>
      <div className="ui-toolbar">
        {workspaceApi && <ToolWorkspacePicker api={workspaceApi} currentWorkspaceId={scope?.workspaceId} />}
        <button type="button" className="ui-button ui-button--secondary" onClick={onCommands}>{t("Commands")}</button>
        <button type="button" className="ui-button ui-button--secondary" onClick={onManage}>{t("Manage plugins")}</button>
      </div>
    </header>
    {toolApi && scope && <ResourceCallRecords api={toolApi} scope={scope} getTarget={getResourceTarget} />}
    {toolApi && scope && <fieldset className="ui-toolbar" aria-label={t("Directory type")}>
      <button type="button" className="ui-button ui-button--secondary" aria-pressed={section === "tools"} onClick={() => setSection("tools")}>{t("Individual tools")}</button>
      <button type="button" className="ui-button ui-button--secondary" aria-pressed={section === "applications"} onClick={() => setSection("applications")}>{t("Full applications")}</button>
    </fieldset>}
    {toolApi && scope && <div hidden={section !== "tools"}><ManualToolDirectory api={toolApi} scope={scope} accessStore={accessStore} catalogRevision={catalogRevision} requestedTool={requestedTool} getResourceTarget={getResourceTarget}
      openApplication={pluginId => {
        const entry = entries.find(candidate => candidate.id === `${pluginId}:open`);
        return entry ? () => onOpen(entry) : undefined;
      }} /></div>}
    <div hidden={section === "tools" && Boolean(toolApi && scope)}>
    <div className="tool-center-search">
      <label htmlFor="tool-center-search">{t("Search applications and tools")}</label>
      <input id="tool-center-search" type="search" className="ui-input" value={query}
        placeholder={t("Search names, uses or tool keywords")}
        onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <label htmlFor="tool-center-category">{t("Category")}</label>
      <select id="tool-center-category" className="ui-select" value={category}
        onChange={event => { setCategory(event.target.value); setPage(0); }}>
        <option value="">{t("All categories")}</option>
        {categories.map(value => <option key={value} value={value}>{t(value)}</option>)}
      </select>
    </div>
    <fieldset className="ui-toolbar" aria-label={t("Application views")}>
      {(["all", "favorites", "recent"] as const).map(value => <button key={value} type="button"
        className="ui-button ui-button--secondary" aria-pressed={view === value}
        disabled={value !== "all" && !accessStore}
        onClick={() => { setView(value); setPage(0); }}>
        {t(value === "all" ? "All applications" : value === "favorites" ? "Favorite applications" : "Recently opened applications")}
      </button>)}
    </fieldset>
    {access.loading && <p role="status">{t("Loading saved commands…")}</p>}
    {access.error && <div role="alert">{t("Saved commands unavailable; tools can still run.")}
      <button type="button" className="ui-button ui-button--ghost" onClick={access.retry}>{t("Retry")}</button></div>}
    <p role="status" aria-live="polite">{t("{matched} / {total} applications").replace("{matched}", String(filtered.length)).replace("{total}", String(entries.length))}</p>
    <div className="tool-center-grid">
      {filtered.slice(currentPage * 40, (currentPage + 1) * 40).map(entry => <article key={entry.id} className="ui-card tool-center-card">
        <h2>{entry.label}</h2><p>{entry.desc}</p>
        <span className="tool-center-source">{t(entry.category)} · {entry.source}</span>
        <div className="ui-toolbar">
          <button type="button" className="ui-button ui-button--primary" onClick={() => onOpen(entry)}>{t("Open")}</button>
          {accessStore && entry.id && <button type="button" className="ui-button ui-button--ghost" disabled={busy}
            aria-label={`${t("Favorite")}: ${entry.label}`} aria-pressed={access.state.favorites.includes(entry.id)}
            onClick={() => { void access.mutate({ kind: "favoriteSet", id: entry.id as string, enabled: !access.state.favorites.includes(entry.id as string) }); }}>
            {t(access.state.favorites.includes(entry.id) ? "Remove favorite" : "Favorite")}
          </button>}
        </div>
      </article>)}
    </div>
    {!filtered.length && <p>{t("No matching applications")}</p>}
    {filtered.length > 40 && <nav className="ui-toolbar" aria-label={t("Application pages")}>
      <button type="button" className="ui-button ui-button--secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("Previous")}</button>
      <span>{currentPage + 1} / {Math.ceil(filtered.length / 40)}</span>
      <button type="button" className="ui-button ui-button--secondary" disabled={(currentPage + 1) * 40 >= filtered.length} onClick={() => setPage(currentPage + 1)}>{t("Next")}</button>
    </nav>}
    {view === "favorites" && missing.length > 0 && <details>
      <summary>{t("Unavailable favorites ({count})").replace("{count}", String(missing.length))}</summary>
      {missing.map(id => <div key={id}>{id} <button type="button" className="ui-button ui-button--ghost" disabled={busy}
        onClick={() => { void access.mutate({ kind: "favoriteSet", id, enabled: false }); }}>{t("Remove favorite")}</button></div>)}
    </details>}
    </div>
  </section>;
}
