import { useEffect, useRef, useState } from "react";
import { t } from "../../shared/i18n";
import type { ToolAccessScope, ToolAccessStore } from "../commandPalette/tool-access";
import { useToolAccess } from "../commandPalette/use-tool-access";
import { ManualToolSession } from "./ManualToolSession";
import { ToolCloseConfirmation } from "./ToolCloseConfirmation";
import type { ResourceTargetProvider } from "./ResourceToolRunner";
import { toolCategoryTitle } from "./tool-categories";
import { type ManualTool, type ManualToolApi, type ToolPage, type ToolDirectoryView, type ToolOpenRequest, manualToolError } from "./manual-tools";

export function ManualToolDirectory({ api, scope, accessStore, openApplication, requestedTool, getResourceTarget }: {
  api: ManualToolApi; scope: ToolAccessScope; accessStore?: ToolAccessStore;
  openApplication(pluginId: string): (() => void) | undefined;
  requestedTool?: ToolOpenRequest;
  getResourceTarget?: ResourceTargetProvider;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ToolDirectoryView>("all");
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [cursor, setCursor] = useState<{ offset: number; revision: string | null; accessRevision?: number | null }>({ offset: 0, revision: null });
  const [page, setPage] = useState<ToolPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<{ tool: ManualTool; revision: string }[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [runningTools, setRunningTools] = useState<string[]>([]);
  const [closeTarget, setCloseTarget] = useState<{ toolId: string; title: string; trigger: HTMLButtonElement; sceneId: string; workspaceId: string } | null>(null);
  const runningToolsRef = useRef<string[]>([]);
  const access = useToolAccess(accessStore, scope);
  const directory = useRef<HTMLDivElement>(null);
  const switcher = useRef<HTMLFieldSetElement>(null);
  const selectedButton = useRef<HTMLButtonElement>(null);
  const consumedRequest = useRef<ToolOpenRequest | undefined>(undefined);
  useEffect(() => {
    setCloseTarget(previous => previous && (previous.sceneId !== scope.sceneId || previous.workspaceId !== scope.workspaceId) ? null : previous);
  }, [scope.sceneId, scope.workspaceId]);
  useEffect(() => {
    function revealSelected() {
      const strip = switcher.current, button = selectedButton.current;
      if (!strip || !button || button.dataset.openToolId !== (activeTool ?? "")) return;
      const frame = strip.getBoundingClientRect(), selected = button.parentElement === strip ? button.getBoundingClientRect()
        : button.parentElement?.getBoundingClientRect() ?? button.getBoundingClientRect();
      // Reveal horizontally without scrolling the surrounding form or stealing focus.
      if (selected.left < frame.left) strip.scrollLeft -= frame.left - selected.left;
      else if (selected.right > frame.right) strip.scrollLeft += selected.right - frame.right;
    }
    revealSelected();
    window.addEventListener("resize", revealSelected);
    return () => window.removeEventListener("resize", revealSelected);
  }, [activeTool]);
  useEffect(() => {
    if (!requestedTool || consumedRequest.current === requestedTool) return;
    consumedRequest.current = requestedTool;
    if (!opened.some(item => item.tool.toolId === requestedTool.tool.toolId)) {
      if (opened.length >= 8) { setError("Close an opened tool before opening another."); setActiveTool(null); return; }
      setOpened(previous => [...previous, requestedTool]);
    }
    setActiveTool(requestedTool.tool.toolId);
  }, [requestedTool, opened]);
  function changePage(offset: number, revision: string) {
    setCursor({ offset, revision, ...(view !== "all" ? { accessRevision: page?.accessRevision } : {}) });
    directory.current?.scrollIntoView?.({ block: "start" });
  }
  function pager(position: "top" | "bottom") {
    if (!page || page.total <= 40) return null;
    return <nav className="ui-toolbar" aria-label={`${t("Tool pages")} · ${t(position === "top" ? "Top" : "Bottom")}`}>
      <button type="button" className="ui-button ui-button--secondary" disabled={loading || cursor.offset === 0}
        onClick={() => changePage(Math.max(0, cursor.offset - 40), page.revision)}>{t("Previous")}</button>
      <span>{Math.floor(cursor.offset / 40) + 1} / {Math.max(1, Math.ceil(page.total / 40))}</span>
      <button type="button" className="ui-button ui-button--secondary" disabled={loading || page.nextOffset === null}
        onClick={() => changePage(page.nextOffset ?? 0, page.revision)}>{t("Next")}</button>
    </nav>;
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: access revision and scope invalidate a personalized pagination snapshot.
  useEffect(() => {
    if (view !== "all") setCursor({ offset: 0, revision: null });
  }, [view, access.state.revision, scope.sceneId, scope.workspaceId]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      void api.searchTools(scope.sceneId, { query, ...cursor,
        ...(source ? { pluginId: source } : {}),
        ...(category ? { categoryId: category } : {}),
        ...(view !== "all" ? { view, workspaceId: scope.workspaceId } : {}) })
        .then(value => { if (active) setPage(value); })
        .catch(reason => { if (active) { setPage(null); setError(manualToolError(reason)); } })
        .finally(() => { if (active) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [api, scope.sceneId, scope.workspaceId, query, cursor, view, source, category]);
  return <div className="manual-tool-directory" ref={directory}>
    <fieldset ref={switcher} className="ui-toolbar tool-open-switcher" aria-label={t("Opened tools")}>
      <button ref={activeTool === null ? selectedButton : undefined} data-open-tool-id="" type="button" className="ui-button ui-button--secondary" aria-pressed={activeTool === null} onClick={() => setActiveTool(null)}>{t("Tool directory")}</button>
      {opened.map(item => <span key={item.tool.toolId} className="ui-toolbar tool-open-item">
        <button type="button" className="ui-button ui-button--secondary" aria-pressed={activeTool === item.tool.toolId}
          ref={activeTool === item.tool.toolId ? selectedButton : undefined} data-open-tool-id={item.tool.toolId} title={item.tool.title}
          onClick={() => setActiveTool(item.tool.toolId)}><span className="tool-open-title">{item.tool.title}</span>{runningTools.includes(item.tool.toolId) ? ` · ${t("Completion unconfirmed")}` : ""}</button>
        <button type="button" className="ui-button ui-button--ghost" aria-label={`${t("Close tool")}: ${item.tool.title}`}
          disabled={runningTools.includes(item.tool.toolId)} onClick={event => setCloseTarget({ toolId: item.tool.toolId, title: item.tool.title,
            trigger: event.currentTarget, sceneId: scope.sceneId, workspaceId: scope.workspaceId })}>{t("Close")}</button>
      </span>)}
    </fieldset>
    <div hidden={activeTool !== null} className="manual-tool-directory-list">
    {accessStore && <fieldset className="ui-toolbar" aria-label={t("Tool list")}>
      {(["all", "favorites", "recent"] as const).map(value => <button key={value} type="button"
        className={`ui-button ui-button--${view === value ? "primary" : "secondary"}`} aria-pressed={view === value}
        onClick={() => { setView(value); setCursor({ offset: 0, revision: null }); }}>{t(value === "all" ? "All tools" : value === "favorites" ? "Favorite tools" : "Recently used tools")}</button>)}
    </fieldset>}
    <div className="tool-directory-filters">
    {page?.sources && <label className="tool-input-field">{t("Tool source")}
      <select className="ui-select" aria-label={t("Tool source")} value={source} disabled={loading} onChange={event => {
        setSource(event.target.value); setCursor({ offset: 0, revision: null });
      }}>
        <option value="">{t("All tool sources")}</option>
        {source && !page.sources.some(item => item.pluginId === source) && <option value={source}>{t("Source unavailable in this list")}</option>}
        {page.sources.map(item => <option key={JSON.stringify([item.pluginId, item.count, item.enabled])} value={item.pluginId}>
          {item.title} · {item.count}{item.enabled ? "" : ` · ${t("Plugin is disabled")}`}
        </option>)}
      </select>
    </label>}
    {page?.categories && <label className="tool-input-field">{t("Tool category")}
      <select className="ui-select" aria-label={t("Tool category")} value={category} disabled={loading} onChange={event => {
        setCategory(event.target.value); setCursor({ offset: 0, revision: null });
      }}>
        <option value="">{t("All tool categories")}</option>
        {category && !page.categories.some(item => item.id === category) && <option value={category}>{t("Category unavailable in this list")}</option>}
        {page.categories.map(item => <option key={JSON.stringify([item.id, item.count])} value={item.id}>{toolCategoryTitle(item.id)} · {item.count}</option>)}
      </select>
    </label>}
    <label className="tool-input-field">{t("Search individual tools")}
      <input type="search" className="ui-input" value={query} maxLength={128} placeholder={t("Search tool names or uses")}
        onChange={event => { setQuery(event.target.value); setCursor({ offset: 0, revision: null }); }} />
    </label>
    </div>
    <p className="tool-center-source">{t("Browsing loads metadata only. Choose a tool to load its input form.")}</p>
    {view !== "all" && <p className="tool-center-source">{t("This list belongs to the current workspace and scene. Removed tools are hidden.")}</p>}
    {access.error && <p role="alert">{t("Tool history could not be loaded or saved.")}
      <button type="button" className="ui-button ui-button--secondary" onClick={access.retry}>{t("Retry")}</button></p>}
    {loading && <p role="status">{t("Loading tools…")}</p>}
    {error && <div role="alert">{t(error)} <button type="button" className="ui-button ui-button--secondary"
      onClick={() => { setCursor({ offset: 0, revision: null }); }}>{t("Reload tools")}</button></div>}
    {page && <>
      <p role="status" key={page.total}>{t("{count} tools").replace("{count}", String(page.total))}</p>
      {pager("top")}
      <div className="tool-center-grid" aria-busy={loading}>
        {page.items.map(tool => <article key={tool.toolId} className="ui-card tool-center-card">
          <h2>{tool.title}</h2><p className="tool-center-source">{tool.applicationName} · {tool.publisher} · {tool.version}</p>
          {tool.description && <p>{tool.description}</p>}
          {!tool.enabled && <span>{t("Plugin is disabled")}</span>}
          <div className="ui-toolbar"><button type="button" className="ui-button ui-button--primary" disabled={loading}
            onClick={() => {
              if (!opened.some(item => item.tool.toolId === tool.toolId)) {
                if (opened.length >= 8) { setError("Close an opened tool before opening another."); return; }
                setOpened(previous => [...previous, { tool, revision: page.revision }]);
              }
              setActiveTool(tool.toolId);
            }}>{t("Open tool")}</button>
            {accessStore && <button type="button" className="ui-button ui-button--ghost"
              disabled={access.loading || access.pending || Boolean(access.error)}
              aria-label={`${t("Favorite")}: ${tool.title}`} aria-pressed={access.state.favorites.includes(tool.accessId)}
              onClick={() => { void access.mutate({ kind: "favoriteSet", id: tool.accessId,
                enabled: !access.state.favorites.includes(tool.accessId) }); }}>
                {/* Shell translation caches text nodes; replace the label when its meaning changes. */}
                <span key={String(access.state.favorites.includes(tool.accessId))}>{t(access.state.favorites.includes(tool.accessId) ? "Remove favorite" : "Favorite")}</span>
              </button>}
          </div>
        </article>)}
      </div>
      {page.total === 0 && <p>{t("No matching tools")}</p>}
      {pager("bottom")}
    </>}
    </div>
    {opened.map(item => <div key={item.tool.toolId} hidden={activeTool !== item.tool.toolId}>
      <ManualToolSession key={JSON.stringify([scope.sceneId, scope.workspaceId, item.tool.toolId])}
        onDirectory={() => setActiveTool(null)} api={api} scope={scope} tool={item.tool} revision={item.revision} accessStore={accessStore}
        onRecentChange={access.retry} getResourceTarget={getResourceTarget}
        onBusy={busy => {
          runningToolsRef.current = busy ? [...new Set([...runningToolsRef.current, item.tool.toolId])] : runningToolsRef.current.filter(id => id !== item.tool.toolId);
          setRunningTools(runningToolsRef.current);
        }}
        onOpenApplication={openApplication(item.tool.pluginId)} />
    </div>)}
    {closeTarget && closeTarget.sceneId === scope.sceneId && closeTarget.workspaceId === scope.workspaceId && <ToolCloseConfirmation
      title={closeTarget.title} trigger={closeTarget.trigger} busy={runningTools.includes(closeTarget.toolId)} onCancel={() => setCloseTarget(null)}
      restoreFocus={() => switcher.current?.querySelector<HTMLButtonElement>("button")?.focus()}
      onConfirm={() => {
        if (runningToolsRef.current.includes(closeTarget.toolId) || closeTarget.sceneId !== scope.sceneId || closeTarget.workspaceId !== scope.workspaceId) return;
        setOpened(previous => previous.filter(item => item.tool.toolId !== closeTarget.toolId));
        if (activeTool === closeTarget.toolId) setActiveTool(null);
        setCloseTarget(null);
      }} />}
  </div>;
}
