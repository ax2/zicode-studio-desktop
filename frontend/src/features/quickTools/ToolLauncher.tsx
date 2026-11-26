import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { matchesSearchQuery } from "../../shared/catalog-search";
import { t } from "../../shared/i18n";
import { isWorkspaceEntryVisible } from "../../shared/workspaceMode";
import type { ToolAccessScope } from "../commandPalette/tool-access";
import type { DirectoryItem, ToolPage } from "../toolCenter/manual-tools";
import type { ApplicationEntry } from "../toolCenter/ToolCenterApp";
import { toolCategoryTitle } from "../toolCenter/tool-categories";

export interface LauncherCursor { offset: number; revision: string | null; accessRevision?: number | null; categoryId?: string }
export interface LauncherResult { page: ToolPage; scope: ToolAccessScope; generation: number; favoriteIds: string[] | null; recentIds: string[] }
export interface ToolLauncherApi {
  applications(): ApplicationEntry[];
  search(view: "all" | "recent", query: string, cursor: LauncherCursor, signal: AbortSignal): Promise<LauncherResult>;
  open(item: DirectoryItem, result: LauncherResult): Promise<unknown>;
  openFavorite(id: string): Promise<boolean>;
  openApplication(id: string): Promise<unknown>;
  setFavorite(id: string, enabled: boolean, result: LauncherResult): Promise<unknown>;
}

export interface QuickTool { id: string; title: string }
const firstPage: LauncherCursor = { offset: 0, revision: null };
const translatorId = "com.zicode.translate:open";
const invalidates = ["zicode:tool-access-changed", "zicode:tool-target-changed", "zicode:plugin-catalog-changed", "zicode:locale-changed"];

function LauncherIcon({ kind }: { kind: "translate" | "app" | "tool" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "translate" ? <path d="M3 5h12M9 3v2m4 0c-1 5-4 8-9 10m2-7c1 3 3 5 6 6m1 7 4-9 4 9m-6.7-3h5.4" />
      : kind === "app" ? <path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z" />
        : <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" />}
  </svg>;
}

function LaunchButton({ title, subtitle, kind, id, onClick }: {
  title: string; subtitle?: string; kind: "translate" | "app" | "tool"; id: string; onClick(): void;
}) {
  return <button type="button" className="ui-button ui-button--ghost tool-launcher-entry"
    data-tool-launcher-open={id} title={kind === "translate" ? t("Translate (Ctrl+Shift+Y)") : subtitle ? `${title} · ${subtitle}` : title}
    aria-keyshortcuts={kind === "translate" ? "Control+Shift+Y Meta+Shift+Y" : undefined} onClick={onClick}>
    <LauncherIcon kind={kind} /><span><strong>{title}</strong>{subtitle && <small>{subtitle}</small>}</span>
  </button>;
}

export function ToolLauncher({ api, favorites, loadingFavorites, errorFavorites, dismiss }: {
  api: ToolLauncherApi; favorites: QuickTool[]; loadingFavorites: boolean; errorFavorites: boolean; dismiss(): void;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"favorites" | "all" | "recent">("favorites");
  const [cursors, setCursors] = useState<LauncherCursor[]>([firstPage]);
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<NonNullable<ToolPage["categories"]>>([]);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; value?: LauncherResult }>({ key: "" });
  const [actionError, setActionError] = useState(false);
  const [pinning, setPinning] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<HTMLElement>(null);
  const opening = useRef(false);
  const mounted = useRef(false);
  const search = query.trim();
  const list = search ? "all" : view;
  const cursor = cursors[cursors.length - 1];
  const key = JSON.stringify([list, search, cursor, categoryId, refresh]);
  const page = result.key === key ? result.value : undefined;
  const loading = list !== "favorites" && result.key !== key;
  const failed = list !== "favorites" && !loading && !page;
  const restart = useCallback(() => { setCursors([firstPage]); setRefresh(value => value + 1); }, []);

  useEffect(() => {
    mounted.current = true;
    input.current?.focus();
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    const searchInput = input.current;
    const previous = lastFocused.current;
    // Removing a focused result can drop focus to the document without a focusin.
    if (!previous || previous.isConnected) return;
    lastFocused.current = null;
    if (document.activeElement === document.body && searchInput?.closest("details")?.open) {
      searchInput.focus();
    }
  });
  useEffect(() => {
    const invalidate = (event: Event) => {
      // Pinning changes saved access, not the all-tools catalog or its page cursor.
      if (event.type === "zicode:tool-access-changed" && list === "all") setRefresh(value => value + 1);
      else restart();
    };
    for (const event of invalidates) window.addEventListener(event, invalidate);
    return () => { for (const event of invalidates) window.removeEventListener(event, invalidate); };
  }, [list, restart]);
  useEffect(() => {
    if (list === "favorites") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api.search(list, search, categoryId ? { ...cursor, categoryId } : cursor, controller.signal).then(value => {
        if (!controller.signal.aborted) {
          setResult({ key, value });
          if (list === "all") setCategories(value.page.categories ?? []);
        }
      }, reason => {
        if (controller.signal.aborted) return;
        if (cursor.offset && reason?.code === "catalog_changed") {
          restart();
          return;
        }
        setResult({ key });
      });
    }, search ? 120 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, list, search, cursor, key, categoryId, restart]);

  const launch = async (action: () => Promise<unknown>) => {
    if (opening.current) return;
    opening.current = true;
    setActionError(false);
    try {
      if (await action() === false) throw new Error("launcher_open_cancelled");
      if (mounted.current) dismiss();
    } catch { if (mounted.current) setActionError(true); }
    finally { opening.current = false; }
  };
  const translate = () => { dismiss(); window.dispatchEvent(new Event("zicode:open-translation")); };
  const translation = () => <LaunchButton key={translatorId} title={t("Translate")} kind="translate" id={translatorId} onClick={translate} />;
  const translationKeywords = "translate translation text language";
  const opensTranslation = !search || matchesSearchQuery(search, [
    t("Translate"),
    translationKeywords,
    t(translationKeywords, "zh-CN"),
    t("Text and language"),
  ]);
  const recentIds = page?.recentIds ?? [];
  const apps = list !== "favorites" && !cursor.offset && !categoryId ? api.applications().filter((entry): entry is ApplicationEntry & { id: string; label: string } =>
    Boolean(!entry.disabled && entry.action && entry.id && entry.label && isWorkspaceEntryVisible(entry.id) && (entry.id !== translatorId || list === "recent") &&
      (list === "recent" ? recentIds.includes(entry.id) :
        matchesSearchQuery(search, [entry.label, entry.desc, t(entry.category), entry.source, ...(entry.keywords ?? [])]))))
    .sort((a, b) => list === "recent" ? recentIds.indexOf(a.id) - recentIds.indexOf(b.id) : a.label.localeCompare(b.label)) : [];
  const tools = page?.page.items.filter(item => item.enabled && isWorkspaceEntryVisible(item.accessId)) ?? [];
  const showTranslation = list === "all" && !cursor.offset && !categoryId && opensTranslation;
  const hasApplications = showTranslation || apps.length > 0;
  const changeView = (next: typeof view) => { setView(next); setQuery(""); setCategoryId(""); setCursors([firstPage]); };
  const manage = () => { dismiss(); window.dispatchEvent(new Event("zicode:manage-quick-tools")); };
  const retryFavorites = () => {
    setActionError(false);
    window.dispatchEvent(new Event("zicode:quick-tools-retry"));
  };
  const toggleFavorite = async (id: string, enabled: boolean) => {
    if (!page || pinning) return;
    setPinning(true); setActionError(false);
    try { await api.setFavorite(id, enabled, page); }
    catch { if (mounted.current) setActionError(true); }
    finally { if (mounted.current) setPinning(false); }
  };

  return <div className="tool-launcher" onFocusCapture={event => { lastFocused.current = event.target; }}>
    <input ref={input} className="ui-input tool-launcher-search" type="search" aria-label={t("Search applications and tools")}
      placeholder={t("Search applications and tools")} value={query}
      onChange={event => { setQuery(event.target.value); setCursors([firstPage]); setActionError(false); }}
      onKeyDown={event => {
        if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229 || !search) return;
        const firstMatch = event.currentTarget.closest(".tool-launcher")
          ?.querySelector<HTMLButtonElement>("[data-tool-launcher-open]:not(:disabled)");
        if (firstMatch) {
          event.preventDefault();
          firstMatch.click();
        }
      }} />
    <div className="ui-toolbar tool-launcher-views">
      <button type="button" className="ui-button ui-button--secondary" aria-pressed={list === "favorites"} onClick={() => changeView("favorites")}>{t("Favorite tools")}</button>
      <button type="button" className="ui-button ui-button--secondary" aria-pressed={list === "all"} onClick={() => changeView("all")}>{t("All tools")}</button>
      <button type="button" className="ui-button ui-button--secondary" aria-pressed={list === "recent"} onClick={() => changeView("recent")}>{t("Recently used tools")}</button>
      {list === "all" && <select className="ui-select" aria-label={t("Category")} value={categoryId}
        onChange={event => { setCategoryId(event.target.value); setCursors([firstPage]); }}>
        <option value="">{t("All categories")}</option>
        {categories.map(category => <option value={category.id} key={category.id}>{toolCategoryTitle(category.id)}</option>)}
      </select>}
    </div>
    {list === "favorites" ? <>
      <div className="tool-launcher-grid">{translation()}
        {favorites.filter(tool => tool.id !== translatorId).map(tool => <LaunchButton key={tool.id} id={tool.id} title={tool.title} kind="tool"
          onClick={() => { void launch(() => api.openFavorite(tool.id)); }} />)}
      </div>
      {loadingFavorites && <p role="status" className="ui-muted">{t("Loading tools…")}</p>}
      {errorFavorites && <button type="button" className="ui-button ui-button--secondary" onClick={retryFavorites}>{t("Retry quick tools")}</button>}
    </> : <>
      {hasApplications && <>
        <h2>{t(list === "all" ? "All applications" : "Recently opened applications")}</h2><div className="tool-launcher-grid">
          {showTranslation && translation()}
          {apps.map(app => app.id === translatorId ? translation() : <LaunchButton key={app.id} id={app.id} title={app.label} subtitle={t(app.category)} kind="app"
            onClick={() => { void launch(() => api.openApplication(app.id)); }} />)}
        </div>
      </>}
      <div className="tool-launcher-results" aria-busy={loading}>
        {loading ? <p role="status" className="ui-muted">{t("Loading tools…")}</p>
          : failed ? <div role="alert" className="tool-launcher-message"><span>{t("Quick tools unavailable. Try again.")}</span>
            <button type="button" className="ui-button ui-button--secondary" onClick={restart}>{t("Retry")}</button></div>
            : tools.length ? <><h2>{t("Tools")}</h2><div className="tool-launcher-grid">
              {tools.map(item => {
                const pinned = page?.favoriteIds?.includes(item.accessId) ?? false;
                return <div className="tool-launcher-tile" key={item.accessId}>
                  <LaunchButton id={item.accessId} title={item.title} subtitle={item.applicationName || toolCategoryTitle(item.categoryId ?? "uncategorized")} kind="tool"
                    onClick={() => { if (page) void launch(() => api.open(item, page)); }} />
                  <button type="button" className="ui-icon-button ui-icon-button--sm ui-icon-button--ghost"
                    title={t(pinned ? "Remove favorite" : "Favorite")} aria-label={`${t(pinned ? "Remove favorite" : "Favorite")}: ${item.title}`}
                    aria-pressed={pinned} disabled={pinning || !page?.favoriteIds}
                    onClick={() => { input.current?.focus(); void toggleFavorite(item.accessId, !pinned); }}>{pinned ? "★" : "☆"}</button>
                </div>;
              })}
            </div></> : !hasApplications && <p role="status" className="ui-muted">{t("No matching tools")}</p>}
        {(cursors.length > 1 || page?.page.nextOffset != null) && <nav className="ui-toolbar" aria-label={t("Tool pages")}>
          <button type="button" className="ui-button ui-button--secondary" disabled={cursors.length < 2}
            onClick={() => { setCursors(cursors.slice(0, -1)); input.current?.focus(); }}>{t("Previous page")}</button>
          <span>{cursors.length}</span>
          <button type="button" className="ui-button ui-button--secondary" disabled={page?.page.nextOffset == null}
            onClick={() => {
              if (page?.page.nextOffset == null) return;
              setCursors([...cursors, { offset: page.page.nextOffset, revision: page.page.revision, accessRevision: page.page.accessRevision }]);
              input.current?.focus();
            }}>{t("Next page")}</button>
        </nav>}
      </div>
    </>}
    {actionError && !(list === "favorites" && errorFavorites) && <p role="alert">{t("Tool changed. Reload its details before retrying.")}</p>}
    <button type="button" className="ui-button ui-button--ghost tool-launcher-manage" onClick={manage}>{t("Choose quick tools")}</button>
  </div>;
}
