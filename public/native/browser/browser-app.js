import { copyText } from "../../ui/copy.js";
import { createBrowserTabActivation } from "./browser-tab-activation.js";
import { createBrowserStartup } from "./browser-startup.js";
import { createBrowserAddressEditor } from "./browser-address-editor.js";
import { resolveBrowserAddress } from "./browser-address.js";
import { createBrowserSearchSettings } from "./browser-search-settings.js";
import { setupBrowserTabMenu } from "./browser-tab-menu.js";
import { createBrowserTabIcon } from "./browser-tab-icon.js";
import { createBrowserFullscreen } from "./browser-fullscreen.js";
import { showBrowserTabSearch } from "./browser-tab-search.js";
import { createBrowserTabStrip } from "./browser-tab-strip.js";
import { createBrowserOverlayPreview, browserOverlayOpen } from "./browser-overlay-preview.js";
import { createBrowserPopups, insertBrowserLinkedTab } from "./browser-popups.js";
import { observeBrowserWindow } from "./browser-window-state.js";
import { createHiddenBrowserView, isBrowserViewportMismatch, withBrowserViewportRetry } from "./browser-viewport-retry.js";
import { browserTabNumber, setupBrowserShortcuts } from "./browser-shortcuts.js";
import { createBrowserFind } from "./browser-find.js";
import { createBrowserPageControls, applyBrowserPageSetting, nextPageZoom, persistBrowserPageSetting } from "./browser-page-controls.js";
import { browserPinLimit, groupBrowserTabs, moveBrowserTab, setupBrowserTabOrdering, toggleBrowserTabPin } from "./browser-tab-order.js";
import { showBrowserDownloads } from "./browser-downloads.js";
import { showBrowserHistory } from "./browser-history.js";
import { showBrowserBookmarks } from "./browser-bookmarks.js";
import { createBrowserSurface } from "./browser-surface.js";
import { createBrowserOptions } from "./browser-options.js";
import { prepareBrowserComparisonDraft, prepareBrowserDraft } from "./browser-chat-draft.js";
import { showBrowserCapture } from "./browser-capture-preview.js";
import { showBrowserReader } from "./browser-reader.js";
import { NotesGateway } from "../plugins/notes-gateway.js";
import { createBrowserNoteWriter } from "./browser-note-snapshot.js";
import { t } from "../../i18n.js";

export function setupBrowserApp({ invoke = globalThis.__TAURI__?.core?.invoke,
  listen = globalThis.__TAURI__?.event?.listen, nativeWindow = globalThis.__TAURI__?.window?.getCurrentWindow?.(), notify = () => {}, getTarget = () => null, onPrepareDraft, canOpenDraftConversation, openDraftConversation, onTranslateSelection } = {}) {
  let startupState, searchSettings, ordering, tabStripControls, tabMenu, tabSearch, pageControls, find, shortcuts, fullscreen;
  let root, viewport, tabsHost, address, addressEditor, status, startup, strip, reloadButton, bookmarkButton;
  let tabs = [], closedTabs = [], active = null, revision = 0, visible = false;
  let initialized = false, initPromise, lastSurface = "", surfaceError = "", saveTail = Promise.resolve();
  let actionTail = Promise.resolve(), restoreError = "", statusMessage = "";
  const enqueue = work => { const result = actionTail.then(work); actionTail = result.catch(report); return result; };
  const act = work => enqueue(work).catch(() => {});
  let saveTimer;
  const nativeTabs = new Set();
  const pendingZoom = new Set();
  const historyStates = new Map();
  const historyButtons = new Map();
  const favicons = new Map();
  const creatingTabs = new Map();
  const creatingPopups = new Map();
  const navigationStates = new Map();
  const waitingDownloads = new Set();
  const downloadObservers = new Set();
  const pageVersions = new Map();
  const control = request => invoke("browser_control", { request });
  const surface = createBrowserSurface(control);
  const paintStatus = () => {
    if (!status) return;
    const failure = navigationStates.get(active) === "failed" ? t("Page could not be loaded") : "";
    const text = [statusMessage, failure].filter(Boolean).join(" ");
    if (status.textContent !== text) status.textContent = text;
  };
  const setStatus = message => { statusMessage = message; paintStatus(); };
  const report = error => setStatus(String(error?.message ?? error));
  const run = work => Promise.resolve().then(work).catch(report);
  const browserWindow = observeBrowserWindow(nativeWindow, () => void run(syncSurface));
  const selected = () => tabs.find(tab => tab.id === active);
  function bounds() {
    const r = viewport.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  const overlayOpen = browserOverlayOpen;
  const preview = createBrowserOverlayPreview({ capture: tab => control({ kind: "snapshot", tab }), host: () => viewport,
    current: tab => visible && selected()?.id === tab && root?.isConnected });
  function blocked() {
    return browserWindow.minimized || document.hidden || !visible || !root?.isConnected || root.closest("[inert],.plugin-surface-hidden") || overlayOpen();
  }
  const popup = createBrowserPopups({
    currentSource: id => {
      if (blocked() || active !== id) return null;
      const version = pageVersions.get(id);
      return () => active === id && visible && !document.hidden && root?.isConnected && !root.closest("[inert],.plugin-surface-hidden") && !overlayOpen() && pageVersions.get(id) === version;
    },
    open: openSavedPage,
    cancel: request => control({ kind: "cancelPopup", request }).catch(() => {}),
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
  function finishStartup() {
    startupState.ready();
    if (restoreError && statusMessage === restoreError) setStatus("");
    restoreError = "";
  }
  async function syncSurface() {
    if (!initialized || !invoke) return;
    await browserWindow.ready;
    const r = bounds();
    if (!selected()) finishStartup();
    if (blocked() || r.width < 1 || r.height < 1 || !selected()) {
      if (lastSurface) await hide(!browserWindow.minimized && overlayOpen(), () => blocked());
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
      if (!current()) return;
      if (surfaceError && statusMessage === surfaceError) setStatus("");
      surfaceError = "";
      preview.clear();
      finishStartup();
    } catch (error) {
      // Minimize can win the race before its resize notification reaches JS.
      if (isBrowserViewportMismatch(error) && await browserWindow.refresh()) {
        if (lastSurface) await hide();
        return;
      }
      lastSurface = "";
      surfaceError = String(error?.message ?? error);
      if (startupState.pending()) throw failStartup();
      throw error;
    }
  }
  function persist(nextTabs, nextActive) {
    const snapshot = nextTabs.filter(tab => !tab.popupOpener).map(({ id, url, title, zoom = 1, muted = false, pinned }) => ({
      id, url, title, zoom, muted, ...(pinned ? { pinned: true } : {}),
    }));
    const opener = nextTabs.find(tab => tab.id === nextActive)?.popupOpener;
    const activeTab = opener ? snapshot.find(tab => tab.id === opener)?.id ?? snapshot[0]?.id ?? null : nextActive;
    // A failed write must not poison every subsequent retry.
    saveTail = saveTail.catch(() => {}).then(async () => {
      const result = await invoke("browser_save_session", { expectedRevision: revision, tabs: snapshot, activeTab });
      revision = result.revision; closedTabs = result.closedTabs ?? [];
    });
    return saveTail;
  }
  function save() { return persist(tabs, active); }
  async function ensureView(tab) {
    if (nativeTabs.has(tab.id)) return;
    if (creatingTabs.has(tab.id)) return creatingTabs.get(tab.id);
    const popupRequest = tab.popupRequest;
    if (popupRequest) creatingPopups.set(tab.id, tab);
    const creation = createHiddenBrowserView(initialBounds => control({
      kind: "create", tabId: tab.id, url: tab.url, bounds: initialBounds, zoom: tab.zoom ?? 1, muted: tab.muted ?? false,
      ...(popupRequest ? { popupRequest } : {}),
    }), bounds()).then(async () => {
      nativeTabs.add(tab.id);
      await control({ kind: "menuLanguage", chinese: t("Find in page") !== "Find in page" });
    }).finally(() => { creatingTabs.delete(tab.id); creatingPopups.delete(tab.id); });
    creatingTabs.set(tab.id, creation);
    return creation;
  }
  async function runPageAction(action, source) {
    if (!source || active !== source || blocked()) return;
    if (action === "zoomIn" || action === "zoomOut" || action === "zoomReset") {
      if (!nativeTabs.has(source)) return;
      return changePageSettings(source, settings => ({ kind: "zoom", value: action === "zoomReset"
        ? 1 : nextPageZoom(settings.zoom, action === "zoomIn" ? 1 : -1) }));
    }
    if (action !== "reload" && !canTraverseHistory(source, action)) return;
    return control({ kind: "action", tab: source, action });
  }
  async function reloadOrStop() {
    const tab = active;
    if (!tab) return;
    if (navigationStates.get(tab) !== "loading") {
      await runPageAction("reload", tab);
      return;
    }
    // WebView2 can report a stopped request as an unsuccessful load.
    navigationStates.set(tab, "stopping");
    paint();
    try {
      await control({ kind: "action", tab, action: "stop" });
    } catch (error) {
      if (navigationStates.get(tab) === "stopping") {
        navigationStates.set(tab, "loading");
        paint();
      }
      throw error;
    }
  }
  const activation = createBrowserTabActivation({
    getTabs: () => tabs, getActive: () => active, prepare: ensureView, persist,
    commit: async (next, id, background = false) => {
      // Reflect the committed session before any fallible native presentation.
      tabs = next; active = id; setStatus(""); paint();
      if (!background) {
        await find.close();
        await syncSurface();
      }
    },
    discard: discardTabView,
  });
  const select = activation.select;
  async function add() {
    await activation.add({ id: crypto.randomUUID(), url: "about:blank", title: t("New tab") });
    address.focus(); address.select();
  }
  async function discardTabView(id) {
    if (nativeTabs.has(id)) {
      await control({ kind: "close", tab: id });
      nativeTabs.delete(id);
    }
    navigationStates.delete(id);
    historyStates.delete(id);
    pageVersions.delete(id);
    favicons.delete(id);
  }
  async function close(id) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const { popupOpener } = tabs[index];
    // Flush current URL/title before the Host records a durable tab's removal.
    if (!popupOpener) await save();
    const wasActive = active === id;
    const nextTabs = tabs.filter(tab => tab.id !== id);
    const fallback = nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? null;
    const nextActive = wasActive ? nextTabs.find(tab => tab.id === popupOpener)?.id ?? fallback : active;
    if (!popupOpener) await persist(nextTabs, nextActive);
    tabs = nextTabs;
    active = nextActive;
    setStatus("");
    paint();
    if (wasActive) await find.close();
    try {
      await discardTabView(id);
    } finally {
      if (wasActive) await syncSurface();
    }
  }
  async function reopen() {
    const entry = closedTabs.at(-1);
    if (!entry) return;
    const tab = { ...entry.tab };
    if (tab.pinned && tabs.filter(item => item.pinned).length >= browserPinLimit) tab.pinned = false;
    await activation.add(tab, { insert: (items, candidate) => {
      const restored = [...items];
      restored.splice(Math.min(entry.index, items.length), 0, candidate);
      return groupBrowserTabs(restored);
    } });
  }
  async function tabShortcut(action, source) {
    // Queued events must not close or move a tab selected after the key press.
    if (blocked() || selected()?.id !== source) return;
    const number = browserTabNumber(action);
    const numberedTab = number === 9 ? tabs.at(-1) : tabs[number - 1];
    if (number && (!numberedTab || numberedTab.id === source)) return;
    // A tab command commits to another page; do not keep the prior address draft.
    if (document.activeElement === address) address.blur();
    if (action === "newTab") return add();
    if (action === "closeTab" && source) await close(source);
    else if (action === "reopenTab") await reopen();
    else if (numberedTab) await select(numberedTab.id);
    else if (["nextTab", "previousTab"].includes(action) && tabs.length > 1) {
      const index = tabs.findIndex(tab => tab.id === source), offset = action === "nextTab" ? 1 : -1;
      await select(tabs[(index + offset + tabs.length) % tabs.length].id);
    }
    if (!blocked() && selected()) await control({ kind: "focusPage", tab: active });
    else if (!selected()) address.focus();
  }
  async function persistPageSettings(id, effective) {
    const target = tabs.find(tab => tab.id === id);
    const settings = { zoom: effective.zoom, muted: effective.muted };
    await persist(tabs.map(tab => tab === target ? { ...tab, ...settings } : tab), active);
    // A navigation event may update the tab's title or URL during the save.
    Object.assign(target, settings);
  }
  function writePageSetting(id, setting) {
    return control({ kind: setting.kind === "zoom" ? "setZoom" : "setMuted", tab: id, [setting.kind]: setting.value });
  }
  async function changePageSettings(id, change) {
    const tab = tabs.find(tab => tab.id === id); if (!tab || !nativeTabs.has(id)) throw new Error(t("Browser tab is no longer available"));
    await applyBrowserPageSetting({ change,
      read: () => control({ kind: "pageSettings", tab: id }),
      write: setting => writePageSetting(id, setting),
      persist: effective => persistPageSettings(id, effective),
    });
    setStatus(""); paint();
  }
  function queueNativeZoom(id) {
    if (pendingZoom.has(id)) return;
    pendingZoom.add(id);
    void act(async () => {
      pendingZoom.delete(id);
      const tab = tabs.find(tab => tab.id === id);
      if (!tab || !nativeTabs.has(id)) return;
      // The event is a notification. A newer wheel or keyboard action may
      // already have changed the live zoom before this work starts.
      const after = await control({ kind: "pageSettings", tab: id });
      const saved = tab.zoom ?? 1;
      if (after.zoom === saved) return;
      await persistBrowserPageSetting({ after,
        rollback: { kind: "zoom", value: saved },
        write: async setting => {
          const live = await control({ kind: "pageSettings", tab: id });
          if (live.zoom === after.zoom) await writePageSetting(id, setting);
        },
        persist: effective => persistPageSettings(id, effective),
      });
    });
  }
  const pinState = (id = active) => {
    const tab = tabs.find(item => item.id === id);
    const available = !tab?.popupOpener;
    return { available, pinned: Boolean(tab?.pinned), enabled: Boolean(available && tab && (tab.pinned || tabs.filter(item => item.pinned).length < browserPinLimit)) };
  };
  async function togglePin(id = active) {
    if (!pinState(id).enabled) return;
    const next = toggleBrowserTabPin(tabs, id);
    if (next === tabs) return;
    await persist(next, active);
    tabs = next; paint();
  }
  async function reorder(change) {
    const next = moveBrowserTab(tabs, change); if (next === tabs) return;
    await persist(next, active);
    tabs = next; setStatus(""); paint(); tabStripControls.focusTab(change.id);
  }
  function canTraverseHistory(id, action) {
    const history = historyStates.get(id);
    return action === "back" ? history?.canGoBack : history?.canGoForward;
  }
  function paintHistoryControls() {
    for (const [action, button] of historyButtons) button.disabled = !canTraverseHistory(active, action);
  }
  function paint() {
    paintStatus();
    paintHistoryControls();
    bookmarkButton.disabled = !/^https?:/.test(selected()?.url ?? "");
    const loading = navigationStates.get(active) === "loading";
    reloadButton.textContent = loading ? "×" : "↻";
    const reloadLabel = t(loading ? "Stop loading" : "Reload");
    reloadButton.title = loading ? reloadLabel : `${reloadLabel} (F5, Ctrl+R)`;
    reloadButton.setAttribute("aria-label", reloadLabel);
    if (loading) reloadButton.removeAttribute("aria-keyshortcuts");
    else reloadButton.setAttribute("aria-keyshortcuts", "F5 Control+r");
    const focusedTab = tabStripControls.focusedControl();
    if (!ordering.dragging) {
    tabsHost.replaceChildren();
    for (const tab of tabs) {
      const item = document.createElement("div"); item.className = "browser-tab";
      const button = makeButton(tab.title || tab.url, () => select(tab.id));
      button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(tab.id === active));
      button.title = tab.url; button.classList.add("browser-tab-title");
      if (tab.pinned) {
        item.dataset.pinned = "";
        button.title = tab.title || tab.url;
        button.setAttribute("aria-label", `${tab.title || tab.url} (${t("Pinned tab")})`);
      }
      const label = document.createElement("span"); label.className = "browser-tab-label"; label.textContent = tab.title || tab.url;
      button.replaceChildren(createBrowserTabIcon(tab.url, favicons.get(tab.id)), label);
      const exit = makeButton("×", () => close(tab.id)); exit.className = "ui-icon-button ui-icon-button--xs ui-icon-button--ghost browser-tab-close"; exit.setAttribute("aria-label", `${t("Close tab")}: ${tab.title || tab.url}`); exit.title = `${t("Close tab")} (Ctrl+W)`; exit.setAttribute("aria-keyshortcuts", "Control+w");
      ordering.decorate(item, button, tab.id);
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-keyshortcuts", `${button.getAttribute("aria-keyshortcuts")} Shift+F10`);
      item.append(button);
      if (tab.muted && !tab.pinned) {
        const unmute = makeButton("", () => changePageSettings(tab.id, { kind: "muted", value: false }));
        unmute.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-tab-unmute";
        unmute.title = t("Unmute tab"); unmute.setAttribute("aria-label", `${t("Unmute tab")}: ${tab.title || tab.url}`);
        unmute.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m11 5-6 4H2v6h3l6 4zM16 9l5 6M21 9l-5 6"/></svg>';
        item.append(unmute);
      }
      if (!tab.pinned) item.append(exit);
      tabsHost.append(item);
    }
    }
    tabStripControls.refresh();
    if (focusedTab && !ordering.dragging) tabStripControls.focusTab(focusedTab.id, focusedTab.selector);
    addressEditor.sync(selected());
    if (!tabs.length) { preview.clear(); viewport.textContent = t("Open a new tab to browse"); }
    else if (!startupState.pending() && !viewport.querySelector(".browser-overlay-preview")) viewport.textContent = "";
  }
  function makeButton(label, action) {
    const button = document.createElement("button"); button.type = "button";
    button.className = "ui-button ui-button--ghost"; button.textContent = label;
    button.addEventListener("click", () => act(action)); return button;
  }
  function failStartup() {
    restoreError = t("Could not restore the browser. Your saved tabs are kept. Please retry.");
    startupState.fail(restoreError); report(restoreError); return new Error(restoreError);
  }
  function restore() { return initialize().catch(() => { failStartup(); }); }
  async function initialize() {
    if (initialized) { await syncSurface(); return; }
    if (!invoke) { const message = t("Browser is available in the Windows desktop app"); setStatus(message); startupState.fail(message, false); return; }
    const [stored, live] = await Promise.all([invoke("browser_get_state"), control({ kind: "status" })]);
    revision = stored.session.revision; surface.seed(live.surfaceRevision);
    tabs = groupBrowserTabs(stored.session.tabs.map(tab => ({ zoom: 1, muted: false, ...tab }))); active = stored.session.activeTab; closedTabs = stored.session.closedTabs ?? [];
    const recentlyClosed = new Set(closedTabs.map(entry => entry.tab.id));
    for (const tab of live.tabs) {
      if (recentlyClosed.has(tab.id)) {
        // A shell reload can interrupt native cleanup after a committed close.
        await control({ kind: "close", tab: tab.id }).catch(report);
        continue;
      }
      nativeTabs.add(tab.id);
      if (tab.history) historyStates.set(tab.id, tab.history);
      if (tab.favicon) favicons.set(tab.id, tab.favicon);
      const saved = tabs.find(item => item.id === tab.id);
      if (saved) { saved.url = tab.url; if (typeof tab.title === "string") saved.title = tab.title || (tab.url === "about:blank" ? t("New tab") : ""); if (tab.settings) Object.assign(saved, tab.settings); } else tabs.push({ ...tab, title: tab.url });
    }
    const visiblePopup = live.tabs.find(tab => tab.popupOpener && tab.visible);
    if (visiblePopup && tabs.some(tab => tab.id === visiblePopup.id)) active = visiblePopup.id;
    active ??= tabs[0]?.id ?? null;
    startup.value = stored.startupMode;
    searchSettings.initialize(stored.searchEngine);
    if (listen) await listen("zicode:browser-event", ({ payload }) => {
      if (payload.kind === "contextAction") {
        if (payload.tab === active && !blocked()) act(async () => {
          if (payload.tab !== active || blocked()) return;
          if (["back", "forward", "reload", "zoomIn", "zoomOut", "zoomReset"].includes(payload.action)) await runPageAction(payload.action, payload.tab);
          else if (payload.action === "find") { await control({ kind: "focusChrome", tab: active }); await find.open(); }
          else if (payload.action === "bookmark") await openBookmarks(true);
          else if (payload.action === "bookmarks") await openBookmarks(false);
          else if (payload.action === "history") await openHistory();
          else if (payload.action === "downloads") await openDownloads();
          else if (payload.action === "read") await readPage();
          else if (payload.action === "reader") await openReader();
          else if (payload.action === "translateSelection") await translatePageSelection(payload.tab);
        });
        return;
      }
      if (payload.kind === "popup") { void popup(payload).catch(report); return; }
      if (payload.kind === "popupClosed") {
        void act(() => tabs.some(tab => tab.id === payload.tab && tab.popupOpener) ? close(payload.tab) : undefined);
        return;
      }
      if (payload.kind === "shortcut") { void shortcuts.native(payload); return; }
      if (payload.kind === "pageZoomChanged") { queueNativeZoom(payload.tab); return; }
      if (payload.kind === "downloadHistoryFailed") { report(t("Could not save download history")); return; }
      if (payload.kind === "downloadChanged") {
        const download = payload.download;
        for (const observer of downloadObservers) observer(download);
        const reminder = t("A download is waiting. Open Downloads to choose where to save it.");
        if (download.state === "waiting") {
          waitingDownloads.add(download.id); report(reminder);
          void act(async () => {
            // Downloads leave the original document open. Do not persist their
            // request URL as a page to redownload automatically after restart.
            const tab = tabs.find(item => item.id === download.tab);
            if (tab && nativeTabs.has(tab.id)) {
              const version = pageVersions.get(tab.id);
              const current = await control({ kind: "url", tab: tab.id });
              if (version === pageVersions.get(tab.id)) {
                tab.url = current.url;
                if (navigationStates.get(tab.id) === "loading") navigationStates.delete(tab.id);
                paint(); await save();
              }
            }
            if (download.tab === active && !blocked()) await openDownloads();
          });
        } else {
          waitingDownloads.delete(download.id);
          if (!waitingDownloads.size && statusMessage === reminder) setStatus("");
        }
        return;
      }
      if (payload.kind === "historyFailed") { report(t("Could not save browsing history")); return; }
      const tab = tabs.find(item => item.id === payload.tab);
      if (payload.kind === "historyChanged") {
        if (tab || creatingTabs.has(payload.tab) || nativeTabs.has(payload.tab)) {
          historyStates.set(payload.tab, payload.history);
          if (payload.tab === active) paintHistoryControls();
        }
        return;
      }
      if (payload.kind === "navigationStarted" || payload.kind === "navigationFinished") {
        const id = payload.tab;
        // Restored tabs and links can start loading before their tab is saved.
        if (!tab && !creatingTabs.has(id) && !nativeTabs.has(id)) return;
        if (payload.kind === "navigationStarted") {
          navigationStates.set(id, "loading");
          if (tab) pageVersions.set(id, (pageVersions.get(id) ?? 0) + 1);
          if (id === active) {
            if (!tabSearch?.open) preview.clear();
            void find.close();
          }
        } else if (!payload.success && !payload.canceled && navigationStates.get(id) !== "stopping") navigationStates.set(id, "failed");
        else navigationStates.delete(id);
        if (id === active) paint();
        return;
      }
      if (!tab) {
        const preparing = creatingPopups.get(payload.tab);
        if (preparing && payload.kind === "title") preparing.title = payload.title;
        if (preparing && (payload.kind === "loading" || (payload.kind === "visited" && payload.sameDocument))) preparing.url = payload.url;
        return;
      }
      if (payload.kind === "favicon") {
        if (payload.image) favicons.set(tab.id, payload.image); else favicons.delete(tab.id);
        const row = [...tabsHost.children].find(row => row.dataset.browserTabId === tab.id);
        row?.querySelector(".browser-tab-icon")?.replaceWith(createBrowserTabIcon(tab.url, favicons.get(tab.id)));
        return;
      }
      if (payload.kind === "title") tab.title = payload.title;
      const routeChanged = payload.kind === "visited" && payload.sameDocument;
      if (payload.kind === "loading" || routeChanged) {
        tab.url = payload.url;
        pageVersions.set(tab.id, (pageVersions.get(tab.id) ?? 0) + 1);
      }
      if (routeChanged || ["title", "loading"].includes(payload.kind)) {
        paint();
        if (!tab.popupOpener) { clearTimeout(saveTimer); saveTimer = setTimeout(() => void act(save), 150); }
      }
      if (payload.kind.endsWith("Blocked")) setStatus(t("This browser action is not available yet"));
    });
    initialized = true;
    const menuLanguage = () => { if (nativeTabs.size) void control({ kind: "menuLanguage", chinese: t("Find in page") !== "Find in page" }).catch(report); };
    window.addEventListener("zicode:locale-changed", () => { menuLanguage(); paintStatus(); });
    menuLanguage(); paint();
    await syncSurface();
  }
  function mount() {
    root = document.createElement("section"); root.className = "studio-browser";
    strip = document.createElement("div"); strip.className = "browser-tab-strip";
    strip.dataset.pageHeaderOwner = "com.zicode.browser";
    tabsHost = document.createElement("div"); tabsHost.className = "browser-tabs"; tabsHost.setAttribute("role", "tablist"); tabsHost.setAttribute("aria-label", t("Browser tabs"));
    ordering = setupBrowserTabOrdering(tabsHost, { onMove: change => void act(() => reorder(change)), onFinish: paint });
    const newTab = makeButton("+", add);
    newTab.setAttribute("aria-label", t("New tab"));
    newTab.title = `${t("New tab")} (Ctrl+T)`;
    newTab.setAttribute("aria-keyshortcuts", "Control+t");
    tabStripControls = createBrowserTabStrip(tabsHost, newTab);
    tabMenu = setupBrowserTabMenu(tabsHost, {
      available: () => initialized && !ordering.dragging && !blocked(),
      focusTab: tabStripControls.focusTab,
      actionsFor: id => {
        const tab = tabs.find(item => item.id === id);
        if (!tab) return [];
        const { available, pinned, enabled } = pinState(id);
        const actions = available ? [{
          label: pinned ? "Unpin tab" : "Pin tab",
          action: () => act(() => togglePin(id)),
          disabled: !enabled,
          hint: !enabled && "Pin up to four tabs",
        }] : [];
        if (nativeTabs.has(id)) actions.push({
          label: tab.muted ? "Unmute tab" : "Mute tab",
          action: () => act(() => changePageSettings(id, { kind: "muted", value: !tab.muted })),
        });
        if (/^https?:/.test(tab.url)) {
          actions.push(
            { label: "Copy tab address", action: () => act(() => copyTabAddress(id)) },
            { label: "Open this page in a new tab", action: () => act(() => openTabPage(id)) },
          );
        }
        actions.push({ label: "Close tab", action: () => act(() => close(id)) });
        return actions;
      },
    });
    strip.append(tabStripControls.element, newTab);
    const nav = document.createElement("form"); nav.className = "browser-navigation";
    for (const [action, label, glyph] of [["back", "Back", "←"], ["forward", "Forward", "→"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-button ui-button--ghost";
      button.textContent = glyph;
      button.setAttribute("aria-label", t(label));
      const shortcut = action === "back" ? "ArrowLeft" : "ArrowRight";
      button.title = `${t(label)} (Alt+${action === "back" ? "←" : "→"})`;
      button.setAttribute("aria-keyshortcuts", `Alt+${shortcut}`);
      button.disabled = true;
      button.addEventListener("click", () => {
        const source = active;
        void act(() => runPageAction(action, source));
      });
      historyButtons.set(action, button);
      nav.append(button);
    }
    reloadButton = makeButton("↻", reloadOrStop);
    reloadButton.setAttribute("aria-label", t("Reload")); reloadButton.title = t("Reload"); nav.append(reloadButton);
    address = document.createElement("input"); address.className = "ui-input browser-address";
    address.setAttribute("aria-label", t("Web address")); address.placeholder = t("Search or enter a web address"); address.spellcheck = false;
    addressEditor = createBrowserAddressEditor(address);
    const go = document.createElement("button");
    go.type = "submit"; go.className = "ui-button ui-button--ghost browser-go"; go.textContent = t("Go");
    nav.append(address, go);
    nav.addEventListener("submit", event => {
      event.preventDefault();
      const submission = addressEditor.submission();
      const source = active;
      if (submission?.text) void act(() => navigate(submission, source));
    });
    const footer = document.createElement("div"); footer.className = "browser-footer";
    status = document.createElement("span"); status.setAttribute("role", "status");
    startup = document.createElement("select"); startup.className = "ui-select"; startup.setAttribute("aria-label", t("Start Studio in")); startup.title = t("Start Studio in");
    for (const [value, label] of [["browser", "Browser"], ["workspace", "Workspace"]]) { const option = document.createElement("option"); option.value = value; option.textContent = t(label); startup.append(option); }
    startup.addEventListener("change", () => run(() => invoke("browser_set_startup_mode", { mode: startup.value })));
    find = createBrowserFind({ control, getTab: selected, available: () => visible && initialized && !blocked(), restoreFocus: async tab => {
      await syncSurface();
      if (visible && initialized && !blocked() && selected()?.id === tab && find.element.hidden) await control({ kind: "focusPage", tab });
    }, report });
    fullscreen = createBrowserFullscreen({ control, report, beforeChange: () => { const menu = root.querySelector(".browser-options"); if (menu) menu.open = false; }, afterChange: () => run(syncSurface) });
    shortcuts = setupBrowserShortcuts({ available: () => visible && initialized && !blocked(), getTab: selected, focusChrome: tab => control({ kind: "focusChrome", tab }), find: () => find.open(), address, tabAction: (action, source) => enqueue(() => tabShortcut(action, source)),
      pageAction: (action, source) => enqueue(() => runPageAction(action, source)), fullscreen: () => fullscreen.toggle(),
      translateSelection: tab => act(() => translatePageSelection(tab, true)),
      searchTabs: (fromPage, source) => act(() => {
        if (!blocked() && selected()?.id === source) return openTabSearch(options, fromPage);
      }), openPanel: (action, fromPage, source) => act(() => {
        if (blocked() || selected()?.id !== source) return;
        const returnToPage = fromPage ? source : undefined;
        if (action === "bookmark" && nativeTabs.has(source)) return openBookmarks(true, returnToPage);
        if (action === "history") return openHistory(returnToPage);
        if (action === "downloads") return openDownloads(returnToPage);
      }), report });
    pageControls = createBrowserPageControls({ getTab: selected, read: tab => control({ kind: "pageSettings", tab }), change: (tab, change) => enqueue(() => changePageSettings(tab, change)) });
    searchSettings = createBrowserSearchSettings({ save: engine => invoke("browser_set_search_engine", { engine }), report });
    let exportingPage = false;
    const exportPage = (kind, success, pending) => {
      const page = selected();
      if (!page || exportingPage) return;
      const { id: tab, url: expectedUrl } = page;
      exportingPage = true;
      void run(async () => {
        try {
          if (active !== tab || blocked()) return;
          if (navigationStates.get(tab) === "loading" || !/^https?:/.test(expectedUrl)) {
            setStatus(t("Wait for the current page to finish loading"));
            return;
          }
          // A wrapped status row changes the native viewport in narrow windows.
          const pendingMessage = pending && t(pending);
          if (pendingMessage) setStatus(pendingMessage);
          await syncSurface();
          await surface.settled();
          if (active !== tab || blocked()) {
            if (pendingMessage && statusMessage === pendingMessage) setStatus("");
            return;
          }
          const saved = await control({ kind, tab, expectedUrl });
          setStatus(`${t(success)} · ${saved.name}`);
        } catch (error) {
          report(t(String(error?.message ?? error)));
        } finally {
          exportingPage = false;
        }
      });
    };
    const options = createBrowserOptions(startup, () => act(async () => {
      await syncSurface();
      if (active && nativeTabs.has(active)) await control({ kind: "action", tab: active, action: "selectAll" });
    }), { reopen: () => act(reopen), canReopen: () => closedTabs.length > 0, bookmarks: () => act(() => openBookmarks(false)), history: () => act(() => openHistory()), searchTabs: () => act(() => openTabSearch(options)), pageControls, find: () => find.open(), fullscreen, searchSettings,
      reader: () => act(openReader),
      translateSelection: onTranslateSelection && (() => {
        const source = active;
        return act(() => translatePageSelection(source));
      }),
      screenshot: () => exportPage("saveScreenshot", "Screenshot saved to Downloads"),
      savePdf: () => exportPage("savePdf", "PDF saved to Downloads", "Preparing page PDF…"),
      pin: { state: pinState, toggle: () => act(togglePin) } });
    const read = makeButton("", readPage); read.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-read";
    read.title = t("Read page"); read.setAttribute("aria-label", read.title);
    read.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h7l2 2h7v16h-7l-2-2H4zM13 5v16M7 7h3M7 11h3M16 9h1M16 13h1"/></svg>';
    bookmarkButton = makeButton("", () => openBookmarks(true)); bookmarkButton.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-bookmark-toggle";
    bookmarkButton.title = `${t("Bookmark this page")} (Ctrl+D)`;
    bookmarkButton.setAttribute("aria-label", t("Bookmark this page"));
    bookmarkButton.setAttribute("aria-keyshortcuts", "Control+d");
    bookmarkButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/></svg>';
    const downloads = makeButton("", () => openDownloads()); downloads.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-downloads-open";
    downloads.title = `${t("Downloads")} (Ctrl+J)`;
    downloads.setAttribute("aria-label", t("Downloads"));
    downloads.setAttribute("aria-keyshortcuts", "Control+j");
    downloads.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';
    footer.append(status, fullscreen.exit, bookmarkButton, read, downloads, options);
    viewport = document.createElement("div"); viewport.className = "browser-viewport";
    nav.append(footer);
    const filePickerSpace = makeButton(t("Use fullscreen to choose files"), () => fullscreen.toggle());
    filePickerSpace.classList.add("browser-file-picker-space");
    root.append(strip, nav, find.element, filePickerSpace, viewport);
    startupState = createBrowserStartup({ root, controls: [strip, nav, filePickerSpace], viewport, retry: () => { initPromise = restore(); } });
    new ResizeObserver(() => void run(syncSurface)).observe(viewport);
    document.addEventListener("visibilitychange", () => void run(syncSurface));
    new MutationObserver(() => void run(syncSurface)).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "hidden", "open", "inert", "aria-modal", "style"] });
  }
  async function openTabSearch(options, fromPage = false) {
    if (!visible || tabSearch) return;
    const source = active;
    const previousFocus = document.activeElement;
    await hide(true);
    if (!visible) return;
    tabSearch = showBrowserTabSearch({
      tabs: [...tabs], active, getIcon: id => favicons.get(id),
      onSelect: id => enqueue(async () => {
        if (!tabs.some(tab => tab.id === id)) throw new Error(t("Browser tab is no longer available"));
        if (id !== active) await select(id);
      }),
      onClose: id => {
        tabSearch = null;
        if (!visible) return;
        const target = id ?? source;
        if (fromPage && target) {
          void run(async () => {
            await syncSurface();
            if (!blocked() && !tabSearch && active === target) await control({ kind: "focusPage", tab: target });
          });
          return;
        }
        if (id) tabStripControls.focusTab(id);
        else if (previousFocus?.isConnected && previousFocus !== document.body && !options.contains(previousFocus)) {
          previousFocus.focus({ preventScroll: true });
        } else options.querySelector("summary").focus();
        void run(syncSurface);
      },
    });
  }
  function restorePanelPage(tab) {
    void run(async () => {
      await syncSurface();
      if (tab && active === tab && !blocked()) await control({ kind: "focusPage", tab });
    });
  }
  async function openBookmarks(editCurrent, returnToPage) {
    const selectedTab = selected(); let current = null;
    if (selectedTab && nativeTabs.has(selectedTab.id)) {
      const result = await control({ kind: "url", tab: selectedTab.id });
      const url = typeof result === "string" ? result : result.url;
      if (active === selectedTab.id && /^https?:/.test(url)) current = { url, title: url === selectedTab.url ? selectedTab.title : url };
    }
    await hide(true);
    showBrowserBookmarks({ invoke, current, editCurrent, onClose: () => restorePanelPage(returnToPage),
      onOpen: openSavedPage,
    });
  }
  async function openDownloads(returnToPage) {
    if (document.querySelector(".browser-downloads-dialog")) return;
    await hide(true);
    showBrowserDownloads({ invoke, onClose: () => restorePanelPage(returnToPage),
      subscribe: observer => { downloadObservers.add(observer); return () => downloadObservers.delete(observer); },
    });
  }
  async function openHistory(returnToPage) {
    await hide(true);
    showBrowserHistory({ invoke, onOpen: openSavedPage, onClose: () => restorePanelPage(returnToPage) });
  }
  async function tabPage(id) {
    const tab = tabs.find(item => item.id === id);
    if (!tab) throw new Error(t("Browser tab is no longer available"));
    const url = nativeTabs.has(id) ? (await control({ kind: "url", tab: id })).url : tab.url;
    if (!/^https?:/.test(url)) throw new Error(t("This browser action is not available yet"));
    return { url, title: url === tab.url ? tab.title : url, zoom: tab.zoom, muted: tab.muted };
  }
  async function copyTabAddress(id) {
    const { url } = await tabPage(id);
    const copied = await copyText(url);
    if (document.activeElement === document.body && !blocked()) tabStripControls.focusTab(id);
    setStatus(t(copied ? "Copied" : "Could not copy text. Select and copy it manually."));
  }
  async function openTabPage(id) {
    const page = await tabPage(id);
    await activation.add({ ...page, id: crypto.randomUUID() }, {
      insert: (items, candidate) => groupBrowserTabs(insertBrowserLinkedTab(items, id, candidate)),
    });
  }
  function openSavedPage(page, { after, current, background, popupRequest } = {}) {
    const tab = { id: crypto.randomUUID(), url: page.url, title: page.title, ...(popupRequest ? { popupRequest, popupOpener: after } : {}) };
    return enqueue(() => activation.add(tab, {
      current, background,
      insert: after ? (items, candidate) => groupBrowserTabs(insertBrowserLinkedTab(items, after, candidate)) : undefined,
    }));
  }
  async function translatePageSelection(source, openEmpty = false) {
    if (!onTranslateSelection || blocked() || active !== source) return;
    const tab = selected(), url = tab?.url;
    let text = "";
    if (tab && nativeTabs.has(source) && /^https?:/.test(url)) {
      const version = pageVersions.get(source);
      await syncSurface();
      const { page } = await invoke("browser_read_selection", { tab: source, expectedUrl: url });
      if (blocked() || active !== source || selected()?.url !== url || pageVersions.get(source) !== version) {
        throw new Error(t("Page changed. Read it again."));
      }
      if (page.truncated) throw new Error(t("Select up to 8,192 characters to translate."));
      text = page.text;
    }
    if (!text && !openEmpty) throw new Error(t("Select text on the webpage first."));
    await onTranslateSelection(text);
  }
  async function openReader() {
    const tab = selected();
    if (blocked()) return;
    if (!tab || !nativeTabs.has(tab.id) || !/^https?:/.test(tab.url) || navigationStates.has(tab.id)) {
      throw new Error(t("Wait for the current page to finish loading"));
    }
    const { id, url } = tab, version = pageVersions.get(id);
    const current = () => !blocked() && active === id && selected()?.url === url && pageVersions.get(id) === version;
    await syncSurface();
    const { page } = await invoke("browser_read_article", { tab: id, expectedUrl: url });
    if (!current()) throw new Error(t("Page changed. Read it again."));
    if (!page.blocks.length) throw new Error(t("No readable text on this page."));
    await hide(true);
    try {
      if (!current()) throw new Error(t("Page changed. Read it again."));
      showBrowserReader(page, () => restorePanelPage(id));
    } catch (error) {
      await syncSurface();
      throw error;
    }
  }
  async function readPage() {
    const tab = selected(); if (!tab || !nativeTabs.has(tab.id)) return;
    const capture = await invoke("browser_capture_page", { tab: tab.id, expectedUrl: tab.url });
    if (active !== tab.id || selected()?.url !== capture.page.url) throw new Error(t("Page changed. Read it again."));
    const openConversation = getTarget()?.runtimeMode === "tools" && await canOpenDraftConversation?.()
      ? openDraftConversation : undefined;
    if (active !== tab.id || selected()?.url !== capture.page.url) throw new Error(t("Page changed. Read it again."));
    await hide(true);
    const version = pageVersions.get(tab.id);
    const isCurrent = () => active === tab.id && selected()?.url === capture.page.url && pageVersions.get(tab.id) === version;
    const peers = tabs.filter(peer => peer.id !== tab.id && nativeTabs.has(peer.id) &&
      /^https?:/.test(peer.url) && !navigationStates.has(peer.id)).map(peer => ({
      tab: peer.id, url: peer.url, title: peer.title, version: pageVersions.get(peer.id),
    }));
    const sourceIsCurrent = source => isCurrent() && source &&
      nativeTabs.has(source.tab) && !navigationStates.has(source.tab) &&
      tabs.some(peer => peer.id === source.tab && peer.url === source.url) &&
      pageVersions.get(source.tab) === source.version;
    const readSource = async source => {
      if (!sourceIsCurrent(source)) throw new Error(t("A selected tab changed. Reopen the page preview and try again."));
      const data = await invoke("browser_capture_page", { tab: source.tab, expectedUrl: source.url });
      if (!sourceIsCurrent(source)) throw new Error(t("A selected tab changed. Reopen the page preview and try again."));
      return data;
    };
    const requestFor = source => source.tab === tab.id
      ? { tab: source.tab, url: source.url, version }
      : peers.find(peer => peer.tab === source.tab);
    const comparison = onPrepareDraft && /^https?:/.test(capture.page.url) && {
      peers,
      readSource,
      prepare: sources => prepareBrowserComparisonDraft({
        sources, getTarget, handoff: onPrepareDraft, openConversation,
        isCurrent: () => sources.every(source => sourceIsCurrent(requestFor(source))),
        readSource: source => readSource(requestFor(source)),
      }),
    };
    showBrowserCapture(capture, () => void run(syncSurface), onPrepareDraft ? attachments => prepareBrowserDraft({
      capture, isCurrent, getTarget, handoff: onPrepareDraft, attachments, openConversation,
      readCurrent: () => invoke("browser_capture_page", { tab: tab.id, expectedUrl: capture.page.url }),
    }) : undefined, isOpen => createBrowserNoteWriter({ capture, getTarget,
      isCurrent: () => isOpen() && isCurrent(), gateway: new NotesGateway(),
      readCurrent: () => invoke("browser_capture_page", { tab: tab.id, expectedUrl: capture.page.url }),
    }), comparison, Boolean(openConversation));
  }
  async function navigate(submission, source) {
    if (active !== source || blocked()) return;
    const url = resolveBrowserAddress(submission.text, searchSettings.value());
    if (!active) await add();
    if (!nativeTabs.has(active)) await ensureView({ ...selected(), url: "about:blank" });
    await find.close();
    await control({ kind: "navigate", tab: active, url });
    addressEditor.accepted(submission);
    selected().url = url; setStatus(""); paint(); await save();
  }
  return {
    renderContent(container) {
      if (!root) mount(); container.replaceChildren(root); visible = true;
      const header = document.getElementById("page-header-actions");
      if (header) header.append(strip);
      initPromise ??= restore();
      void initPromise.then(() => run(syncSurface));
    },
    async canDeactivate() { tabMenu?.close(); tabSearch?.close(); await fullscreen?.leave(); await find?.close(); ordering?.cancel(); visible = false; await initPromise; await hide(); return true; },
    deactivate() { tabMenu?.close(); tabSearch?.close(); void fullscreen?.leave(); void find?.close(); ordering?.cancel(); visible = false; void run(hide); },
  };
}
