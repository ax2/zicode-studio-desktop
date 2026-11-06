import { MULTI_PROJECT_UI_ENABLED, isWorkspaceEntryVisible } from "../../shared/workspaceMode";
import { ToolSavedFiles } from "./ToolSavedFiles";
import { useEffect, useMemo, useState } from "react";
import { matchesSearchTerms, prepareSearchQuery } from "../../shared/catalog-search";
import { t } from "../../shared/i18n";
import type { PaletteCommand } from "../commandPalette/commandPaletteLogic";
import { accessCommands, type ToolAccessScope, type ToolAccessStore } from "../commandPalette/tool-access";
import { useToolAccess } from "../commandPalette/use-tool-access";
import { ManualToolDirectory } from "./ManualToolDirectory";
import type { ManualToolApi, ToolOpenRequest, ViewOperation } from "./manual-tools";
import type { ResourceTargetProvider, ReceiveNoteDraft } from "./ResourceToolRunner";
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
  receiveNoteDraft?: ReceiveNoteDraft;
  onOpen(entry: ApplicationEntry): void;
  onOpenToolApplication?(pluginId: string, capabilityId: string, version: string, entry: ApplicationEntry): void;
  onOpenViewOperation?(operation: ViewOperation, revision: string, scope: ToolAccessScope): Promise<unknown> | unknown;
  onManage(): void;
  onCommands(): void;
  workspaceApi?: ToolWorkspaceApi;
}

export function ToolCenterApp({ entries, accessStore, scope, toolApi, catalogRevision, requestedTool, getResourceTarget, receiveNoteDraft, onOpen, onOpenToolApplication, onOpenViewOperation, onManage, onCommands, workspaceApi }: ToolCenterProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState(initialTrayToolView);
  useEffect(() => subscribeTrayToolView(next => { setView(next); setPage(0); }), []);
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const access = useToolAccess(accessStore, scope);
  const historyReady = Boolean(accessStore && scope && !access.loading && !access.error);
  const effectiveView = historyReady ? view : "all";
  const categories = [...new Set(entries.map(entry => entry.category))];
  const filtered = useMemo(() => {
    const terms = prepareSearchQuery(query);
    const ids = new Set(accessCommands(entries, access.state, effectiveView).map(entry => entry.id));
    const visible = entries.filter(entry => ids.has(entry.id) && (!category || category === entry.category) &&
      matchesSearchTerms(terms, [entry.label, entry.desc, t(entry.category), entry.source, ...(entry.keywords ?? [])]));
    if (effectiveView === "recent") {
      const order = new Map(access.state.recent.map((entry, index) => [entry.id, index]));
      visible.sort((a, b) => (order.get(a.id ?? "") ?? 0) - (order.get(b.id ?? "") ?? 0));
    }
    return visible;
  }, [entries, access.state, effectiveView, category, query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 40) - 1));
  const missing = access.state.favorites.filter(id => isWorkspaceEntryVisible(id) && id.endsWith(":open") && !entries.some(entry => entry.id === id));
  const busy = access.loading || access.pending || access.error;
  return <section className="tool-center" aria-labelledby="tool-center-title">
    <header className="tool-center-header">
      <div><h1 id="tool-center-title">{t("Tools")}</h1>
        <p>{t("Search tools or favorite them for quick access from Home and the tray.")}</p></div>
      <div className="ui-toolbar">
        {MULTI_PROJECT_UI_ENABLED && workspaceApi && <ToolWorkspacePicker api={workspaceApi} currentWorkspaceId={scope?.workspaceId} />}
        {scope && toolApi?.savedOutputs && <ToolSavedFiles key={JSON.stringify([scope.sceneId, scope.workspaceId])} gateway={toolApi.savedOutputs} scope={scope} />}
        <button type="button" className="ui-button ui-button--secondary" onClick={onCommands}>{t("Commands")}</button>
        <button type="button" className="ui-button ui-button--secondary" onClick={onManage}>{t("Manage plugins")}</button>
      </div>
    </header>
    {toolApi && scope && <div><ManualToolDirectory api={toolApi} scope={scope} accessStore={accessStore} catalogRevision={catalogRevision} requestedTool={requestedTool} getResourceTarget={getResourceTarget} receiveNoteDraft={receiveNoteDraft}
      openViewOperation={onOpenViewOperation ? (operation, revision) => onOpenViewOperation(operation, revision, scope) : undefined}
      openApplication={(pluginId, capabilityId, version) => {
        const entry = entries.find(candidate => candidate.id === `${pluginId}:open`);
        return entry && !entry.disabled ? () => onOpenToolApplication
          ? onOpenToolApplication(pluginId, capabilityId, version, entry) : onOpen(entry) : undefined;
      }} /></div>}
    <details className="tool-center-extras" open={!toolApi || !scope}>
    <summary>{t("More apps")}</summary>
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
        className="ui-button ui-button--secondary" aria-pressed={effectiveView === value}
        disabled={value !== "all" && !historyReady}
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
        {entry.disabled && <p role="status">{t("Disabled")}</p>}
        <div className="ui-toolbar">
          {entry.disabled
            ? <button type="button" className="ui-button ui-button--secondary" onClick={onManage}>{t("Manage plugins")}</button>
            : <button type="button" className="ui-button ui-button--primary" onClick={() => onOpen(entry)}>{t("Open")}</button>}
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
    {effectiveView === "favorites" && missing.length > 0 && <details>
      <summary>{t("Unavailable favorites ({count})").replace("{count}", String(missing.length))}</summary>
      {missing.map(id => <div key={id}>{id} <button type="button" className="ui-button ui-button--ghost" disabled={busy}
        onClick={() => { void access.mutate({ kind: "favoriteSet", id, enabled: false }); }}>{t("Remove favorite")}</button></div>)}
    </details>}
    </details>
    {toolApi && scope && <details className="tool-center-extras">
      <summary>{t("Troubleshooting")}</summary>
      <p className="ui-muted">{t("Review file and service operations when a result is uncertain.")}</p>
      <ResourceCallRecords api={toolApi} scope={scope} getTarget={getResourceTarget} />
    </details>}
  </section>;
}
