import { createBrowserOverlayPreview, browserOverlayOpen } from "./browser-overlay-preview.js";
import { createBrowserPopups, insertBrowserLinkedTab } from "./browser-popups.js";
import { withBrowserViewportRetry } from "./browser-viewport-retry.js";
import { setupBrowserShortcuts } from "./browser-shortcuts.js";
import { createBrowserFind } from "./browser-find.js";
import { createBrowserPageControls, applyBrowserPageSetting, nextPageZoom } from "./browser-page-controls.js";
import { moveBrowserTab, setupBrowserTabOrdering } from "./browser-tab-order.js";
import { showBrowserHistory } from "./browser-history.js";
import { showBrowserBookmarks } from "./browser-bookmarks.js";
import { createBrowserSurface } from "./browser-surface.js";
import { createBrowserOptions } from "./browser-options.js";
import { prepareBrowserDraft } from "./browser-chat-draft.js";
import { showBrowserCapture } from "./browser-capture-preview.js";
import { t } from "../../i18n.js";

export function setupBrowserApp({ invoke = globalThis.__TAURI__?.core?.invoke,
  listen = globalThis.__TAURI__?.event?.listen, notify = () => {}, getTarget = () => null, onPrepareDraft } = {}) {
  let ordering, pageControls, find, shortcuts;
  let root, viewport, tabsHost, address, status, startup, strip, reloadButton, bookmarkButton;
  let tabs = [], closedTabs = [], active = null, revision = 0, visible = false, changingTabs = 0;
  let initialized = false, initPromise, lastSurface = "", surfaceError = "", saveTail = Promise.resolve();
  let actionTail = Promise.resolve();
  const enqueue = work => { const result = actionTail.then(work); actionTail = result.catch(report); return result; };
  const act = work => enqueue(work).catch(() => {});
  let saveTimer;
  const nativeTabs = new Set();
  const creatingTabs = new Map();
  const loadingTabs = new Set();
  const pageVersions = new Map();
  const control = request => invoke("browser_control", { request });
  const surface = createBrowserSurface(control);
  const report = error => { if (status) status.textContent = String(error?.message ?? error); };
  const run = work => Promise.resolve().then(work).catch(report);
  const selected = () => tabs.find(tab => tab.id === active);
  function bounds() {
    const r = viewport.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  const overlayOpen = browserOverlayOpen;
  const preview = createBrowserOverlayPreview({ capture: tab => control({ kind: "snapshot", tab }), host: () => viewport,
    current: tab => visible && selected()?.id === tab && root?.isConnected });
  function blocked() {
    return document.hidden || changingTabs || !visible || !root?.isConnected || root.closest("[inert],.plugin-surface-hidden") || overlayOpen();
  }
  const popup = createBrowserPopups({
    currentSource: id => {
      if (blocked() || active !== id) return null;
      const version = pageVersions.get(id);
      return () => active === id && visible && !document.hidden && root?.isConnected && !root.closest("[inert],.plugin-surface-hidden") && !overlayOpen() && pageVersions.get(id) === version;
    },
    open: openSavedPage,
    blocked: () => report(t("Popup blocked")),
  });
  async function hide(preserve = false, stillNeeded = () => true) {
    if (preserve && selected() && nativeTabs.has(active) && lastSurface) {
      try { await preview.show(active); } catch (error) { report(error); }
      if (!stillNeeded()) { preview.clear(); return; }
    } else if (!preserve) preview.clear();
    lastSurface = "";
    if (invoke) await surface.send({ kind: "hide" });
  }
  async function syncSurface() {
    if (!initialized || !invoke) return;
    const r = bounds();
    if (blocked() || r.width < 1 || r.height < 1 || !selected()) {
      if (lastSurface) await hide(overlayOpen(), () => blocked());
      return;
    }
    try {
      const tab = selected();
      await ensureView(tab);
    const current = () => !blocked() && selected()?.id === tab.id;
    if (!current()) return;
    const key = JSON.stringify([tab.id, bounds()]);
    if (key === lastSurface) return;
    lastSurface = key;
      await withBrowserViewportRetry(() => surface.send({ kind: "present", tab: tab.id, bounds: bounds(), focus: false }), current);
      if (surfaceError && status.textContent === surfaceError) status.textContent = "";
      surfaceError = "";
      preview.clear();
    } catch (error) { lastSurface = ""; surfaceError = String(error?.message ?? error); throw error; }
  }
  function persist(nextTabs, nextActive) {
    const snapshot = nextTabs.map(({ id, url, title, zoom = 1, muted = false }) => ({ id, url, title, zoom, muted }));
    // A failed write must not poison every subsequent retry.
    saveTail = saveTail.catch(() => {}).then(async () => {
      const result = await invoke("browser_save_session", { expectedRevision: revision, tabs: snapshot, activeTab: nextActive });
      revision = result.revision; closedTabs = result.closedTabs ?? [];
    });
    return saveTail;
  }
  function save() { return persist(tabs, active); }
  async function ensureView(tab) {
    if (nativeTabs.has(tab.id)) return;
    if (creatingTabs.has(tab.id)) return creatingTabs.get(tab.id);
    const creation = withBrowserViewportRetry(() => control({ kind: "create", tabId: tab.id, url: tab.url, bounds: bounds(), zoom: tab.zoom ?? 1, muted: tab.muted ?? false }))
      .then(async () => { nativeTabs.add(tab.id); await control({ kind: "menuLanguage", chinese: t("Find in page") !== "Find in page" }); }).finally(() => creatingTabs.delete(tab.id));
    creatingTabs.set(tab.id, creation);
    return creation;
  }
  async function transition(work) {
    await find?.close();
    changingTabs++;
    try { await hide(); return await work(); }
    finally { changingTabs--; await syncSurface(); }
  }
  async function select(id) {
    return transition(async () => {
      active = id; paint();
      if (selected()) await ensureView(selected());
      await save();
    });
  }
  async function add() {
    const tab = { id: crypto.randomUUID(), url: "about:blank", title: t("New tab") };
    tabs.push(tab); await select(tab.id); address.focus(); address.select();
  }
  async function close(id) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    // Flush current URL/title before the Host records the removed tab.
    await save();
    return transition(async () => {
      if (nativeTabs.has(id)) { await control({ kind: "close", tab: id }); nativeTabs.delete(id); }
      const nextTabs = tabs.filter(tab => tab.id !== id);
      const nextActive = active === id ? nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? null : active;
      try { await persist(nextTabs, nextActive); }
      catch (error) { if (selected()) await ensureView(selected()); throw error; }
      loadingTabs.delete(id); pageVersions.delete(id);
      tabs = nextTabs; active = nextActive; status.textContent = ""; paint();
      if (selected()) await ensureView(selected());
    });
  }
  async function reopen() {
    const entry = closedTabs.at(-1); if (!entry) return;
    return transition(async () => {
      const tab = { ...entry.tab };
      try {
        await ensureView(tab);
        const nextTabs = [...tabs]; nextTabs.splice(Math.min(entry.index, tabs.length), 0, tab);
        await persist(nextTabs, tab.id);
        tabs = nextTabs; active = tab.id; status.textContent = ""; paint();
      } catch (error) {
        if (nativeTabs.has(tab.id)) { await control({ kind: "close", tab: tab.id }); nativeTabs.delete(tab.id); }
        throw error;
      }
    });
  }
  async function changePageSettings(id, change) {
    const tab = tabs.find(tab => tab.id === id); if (!tab || !nativeTabs.has(id)) throw new Error(t("Browser tab is no longer available"));
    await applyBrowserPageSetting({ change,
      read: () => control({ kind: "pageSettings", tab: id }),
      write: setting => control({ kind: setting.kind === "zoom" ? "setZoom" : "setMuted", tab: id, [setting.kind]: setting.value }),
      persist: async effective => {
        const next = tabs.map(tab => tab.id === id ? { ...tab, zoom: effective.zoom, muted: effective.muted } : tab);
        await persist(next, active); tabs = next; status.textContent = ""; paint();
      },
    });
  }
  async function reorder(change) {
    const next = moveBrowserTab(tabs, change); if (next === tabs) return;
    await persist(next, active);
    tabs = next; status.textContent = ""; paint(); ordering.focus(change.id);
  }
  function paint() {
    bookmarkButton.disabled = !/^https?:/.test(selected()?.url ?? "");
    const loading = loadingTabs.has(active);
    reloadButton.textContent = loading ? "×" : "↻";
    reloadButton.title = t(loading ? "Stop loading" : "Reload");
    reloadButton.setAttribute("aria-label", reloadButton.title);
    if (!ordering.dragging) {
    tabsHost.replaceChildren();
    for (const tab of tabs) {
      const item = document.createElement("div"); item.className = "browser-tab";
      const button = makeButton(tab.title || tab.url, () => select(tab.id));
      button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(tab.id === active));
      button.title = tab.url; button.classList.add("browser-tab-title");
      const exit = makeButton("×", () => close(tab.id)); exit.setAttribute("aria-label", `${t("Close tab")}: ${tab.title || tab.url}`);
      ordering.decorate(item, button, tab.id);
      item.append(button);
      if (tab.muted) {
        const unmute = makeButton("", () => changePageSettings(tab.id, { kind: "muted", value: false }));
        unmute.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-tab-unmute";
        unmute.title = t("Unmute tab"); unmute.setAttribute("aria-label", `${t("Unmute tab")}: ${tab.title || tab.url}`);
        unmute.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m11 5-6 4H2v6h3l6 4zM16 9l5 6M21 9l-5 6"/></svg>';
        item.append(unmute);
      }
      item.append(exit); tabsHost.append(item);
    }
    }
    if (document.activeElement !== address) address.value = selected()?.url === "about:blank" ? "" : selected()?.url ?? "";
    if (!tabs.length) { preview.clear(); viewport.textContent = t("Open a new tab to browse"); }
    else if (!viewport.querySelector(".browser-overlay-preview")) viewport.textContent = "";
  }
  function makeButton(label, action) {
    const button = document.createElement("button"); button.type = "button";
    button.className = "ui-button ui-button--ghost"; button.textContent = label;
    button.addEventListener("click", () => act(action)); return button;
  }
  async function initialize() {
    if (!invoke) { status.textContent = t("Browser is available in the Windows desktop app"); return; }
    const [stored, live] = await Promise.all([invoke("browser_get_state"), control({ kind: "status" })]);
    revision = stored.session.revision; surface.seed(live.surfaceRevision);
    tabs = stored.session.tabs.map(tab => ({ zoom: 1, muted: false, ...tab })); active = stored.session.activeTab; closedTabs = stored.session.closedTabs ?? [];
    for (const tab of live.tabs) {
      nativeTabs.add(tab.id);
      const saved = tabs.find(item => item.id === tab.id);
      if (saved) { saved.url = tab.url; if (tab.settings) Object.assign(saved, tab.settings); } else tabs.push({ ...tab, title: tab.url });
    }
    active ??= tabs[0]?.id ?? null;
    startup.value = stored.startupMode;
    if (listen) await listen("zicode:browser-event", ({ payload }) => {
      if (payload.kind === "contextAction") {
        if (payload.tab === active && !blocked()) act(async () => {
          if (payload.tab !== active || blocked()) return;
          if (["back", "forward", "reload"].includes(payload.action)) await control({ kind: "action", tab: active, action: payload.action });
          else if (payload.action === "find") { await control({ kind: "focusChrome", tab: active }); await find.open(); }
          else if (payload.action === "bookmark") await openBookmarks(true);
          else if (payload.action === "history") await openHistory();
          else if (payload.action === "read") await readPage();
          else if (["zoomIn", "zoomOut", "zoomReset"].includes(payload.action)) {
            const settings = await control({ kind: "pageSettings", tab: active });
            const zoom = payload.action === "zoomReset" ? 1 : nextPageZoom(settings.zoom, payload.action === "zoomIn" ? 1 : -1);
            await changePageSettings(active, { kind: "zoom", value: zoom });
          }
        });
        return;
      }
      if (payload.kind === "popup") { void popup(payload).catch(report); return; }
      if (payload.kind === "shortcut") { void shortcuts.native(payload); return; }
      if (payload.kind === "historyFailed") { report(t("Could not save browsing history")); return; }
      const tab = tabs.find(item => item.id === payload.tab);
      if (!tab) return;
      if (payload.kind === "title") tab.title = payload.title;
      if (payload.kind === "loading") {
        if (payload.tab === active && !payload.finished) preview.clear();
        if (!payload.finished && payload.tab === active) void find.close();
        tab.url = payload.url; pageVersions.set(tab.id, (pageVersions.get(tab.id) ?? 0) + 1);
        if (payload.finished) loadingTabs.delete(tab.id); else loadingTabs.add(tab.id);
      }
      if (payload.kind === "navigationFinished") { loadingTabs.delete(tab.id); paint(); }
      if (["title", "loading"].includes(payload.kind)) { paint(); clearTimeout(saveTimer); saveTimer = setTimeout(() => void act(save), 150); }
      if (payload.kind.endsWith("Blocked")) status.textContent = t("This browser action is not available yet");
      if (payload.kind === "navigationFinished" && !payload.success) status.textContent = t("Page could not be loaded");
    });
    initialized = true;
    const menuLanguage = () => { if (nativeTabs.size) void control({ kind: "menuLanguage", chinese: t("Find in page") !== "Find in page" }).catch(report); };
    window.addEventListener("zicode:locale-changed", menuLanguage); menuLanguage(); paint();
    await syncSurface();
  }
  function mount() {
    root = document.createElement("section"); root.className = "studio-browser";
    strip = document.createElement("div"); strip.className = "browser-tab-strip";
    strip.dataset.pageHeaderOwner = "com.zicode.browser";
    tabsHost = document.createElement("div"); tabsHost.className = "browser-tabs"; tabsHost.setAttribute("role", "tablist"); tabsHost.setAttribute("aria-label", t("Browser tabs"));
    ordering = setupBrowserTabOrdering(tabsHost, { onMove: change => void act(() => reorder(change)), onFinish: paint });
    strip.append(tabsHost, makeButton("+", add)); strip.lastChild.setAttribute("aria-label", t("New tab"));
    const nav = document.createElement("form"); nav.className = "browser-navigation";
    for (const [action, label, glyph] of [["back", "Back", "←"], ["forward", "Forward", "→"]]) {
      const button = makeButton(glyph, () => active && control({ kind: "action", tab: active, action })); button.setAttribute("aria-label", t(label)); nav.append(button);
    }
    reloadButton = makeButton("↻", () => active && control({ kind: "action", tab: active, action: loadingTabs.has(active) ? "stop" : "reload" }));
    reloadButton.setAttribute("aria-label", t("Reload")); reloadButton.title = t("Reload"); nav.append(reloadButton);
    address = document.createElement("input"); address.className = "ui-input browser-address";
    address.setAttribute("aria-label", t("Web address")); address.placeholder = t("Enter a web address"); address.spellcheck = false;
    const go = makeButton(t("Go"), navigate); go.classList.add("browser-go");
    nav.append(address, go);
    nav.addEventListener("submit", event => { event.preventDefault(); void act(navigate); });
    const footer = document.createElement("div"); footer.className = "browser-footer";
    status = document.createElement("span"); status.setAttribute("role", "status");
    startup = document.createElement("select"); startup.className = "ui-select"; startup.setAttribute("aria-label", t("Start Studio in")); startup.title = t("Start Studio in");
    for (const [value, label] of [["browser", "Browser"], ["workspace", "Workspace"]]) { const option = document.createElement("option"); option.value = value; option.textContent = t(label); startup.append(option); }
    startup.addEventListener("change", () => run(() => invoke("browser_set_startup_mode", { mode: startup.value })));
    find = createBrowserFind({ control, getTab: selected, available: () => visible && initialized && !blocked(), restoreFocus: async tab => {
      await syncSurface();
      if (visible && initialized && !blocked() && selected()?.id === tab && find.element.hidden) await control({ kind: "focusPage", tab });
    }, report });
    shortcuts = setupBrowserShortcuts({ available: () => visible && initialized && !blocked(), getTab: selected, focusChrome: tab => control({ kind: "focusChrome", tab }), find: () => find.open(), address, report });
    pageControls = createBrowserPageControls({ getTab: selected, read: tab => control({ kind: "pageSettings", tab }), change: (tab, change) => enqueue(() => changePageSettings(tab, change)) });
    const options = createBrowserOptions(startup, () => act(async () => {
      await syncSurface();
      if (active && nativeTabs.has(active)) await control({ kind: "action", tab: active, action: "selectAll" });
    }), { reopen: () => act(reopen), canReopen: () => closedTabs.length > 0, bookmarks: () => act(() => openBookmarks(false)), history: () => act(openHistory), pageControls, find: () => find.open() });
    const read = makeButton("", readPage); read.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-read";
    read.title = t("Read page"); read.setAttribute("aria-label", read.title);
    read.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h7l2 2h7v16h-7l-2-2H4zM13 5v16M7 7h3M7 11h3M16 9h1M16 13h1"/></svg>';
    bookmarkButton = makeButton("", () => openBookmarks(true)); bookmarkButton.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-bookmark-toggle";
    bookmarkButton.title = t("Bookmark this page"); bookmarkButton.setAttribute("aria-label", bookmarkButton.title);
    bookmarkButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/></svg>';
    footer.append(status, bookmarkButton, read, options);
    viewport = document.createElement("div"); viewport.className = "browser-viewport";
    nav.append(footer);
    root.append(strip, nav, find.element, viewport);
    new ResizeObserver(() => void run(syncSurface)).observe(viewport);
    document.addEventListener("visibilitychange", () => void run(syncSurface));
    new MutationObserver(() => void run(syncSurface)).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "hidden", "open", "inert", "aria-modal", "style"] });
  }
  async function openBookmarks(editCurrent) {
    const selectedTab = selected(); let current = null;
    if (selectedTab && nativeTabs.has(selectedTab.id)) {
      const result = await control({ kind: "url", tab: selectedTab.id });
      const url = typeof result === "string" ? result : result.url;
      if (active === selectedTab.id && /^https?:/.test(url)) current = { url, title: url === selectedTab.url ? selectedTab.title : url };
    }
    await hide(true);
    showBrowserBookmarks({ invoke, current, editCurrent, onClose: () => void run(syncSurface),
      onOpen: openSavedPage,
    });
  }
  async function openHistory() {
    await hide(true);
    showBrowserHistory({ invoke, onOpen: openSavedPage, onClose: () => void run(syncSurface) });
  }
  function openSavedPage(page, { after, current = () => true } = {}) {
    return enqueue(() => {
      if (!current()) return;
      return transition(async () => {
        const tab = { id: crypto.randomUUID(), url: page.url, title: page.title };
        try {
          await ensureView(tab);
          if (!current()) { await control({ kind: "close", tab: tab.id }); nativeTabs.delete(tab.id); return; }
          const next = after ? insertBrowserLinkedTab(tabs, after, tab) : [...tabs, tab];
          await persist(next, tab.id);
          tabs = next; active = tab.id; status.textContent = ""; paint();
        } catch (error) {
          if (nativeTabs.has(tab.id)) { await control({ kind: "close", tab: tab.id }); nativeTabs.delete(tab.id); }
          throw error;
        }
      });
    });
  }
  async function readPage() {
    const tab = selected(); if (!tab || !nativeTabs.has(tab.id)) return;
    const capture = await invoke("browser_capture_page", { tab: tab.id, expectedUrl: tab.url });
    if (active !== tab.id || selected()?.url !== capture.page.url) throw new Error(t("Page changed. Read it again."));
    await hide(true);
    const version = pageVersions.get(tab.id);
    const isCurrent = () => active === tab.id && selected()?.url === capture.page.url && pageVersions.get(tab.id) === version;
    showBrowserCapture(capture, () => void run(syncSurface), onPrepareDraft ? () => prepareBrowserDraft({
      capture, isCurrent, getTarget, handoff: onPrepareDraft,
      readCurrent: () => invoke("browser_capture_page", { tab: tab.id, expectedUrl: capture.page.url }),
    }) : undefined);
  }
  async function navigate() {
    const input = address.value.trim(); if (!input) return;
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`).href;
    if (!active) await add();
    if (!nativeTabs.has(active)) {
      await control({ kind: "create", tabId: active, url: "about:blank", bounds: bounds() });
      nativeTabs.add(active);
    }
    await find.close();
    await control({ kind: "navigate", tab: active, url });
    selected().url = url; status.textContent = ""; paint(); await save();
  }
  return {
    renderContent(container) {
      if (!root) mount(); container.replaceChildren(root); visible = true;
      const header = document.getElementById("page-header-actions");
      if (header) header.append(strip);
      initPromise ??= initialize().catch(error => { report(error); notify(String(error)); });
      void initPromise.then(() => run(syncSurface));
    },
    async canDeactivate() { await find?.close(); ordering?.cancel(); visible = false; await initPromise; await hide(); return true; },
    deactivate() { void find?.close(); ordering?.cancel(); visible = false; void run(hide); },
  };
}

