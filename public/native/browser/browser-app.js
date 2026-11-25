import { copyText } from "../../ui/copy.js";
import { createBrowserTabActivation } from "./browser-tab-activation.js";
import { createBrowserStartup } from "./browser-startup.js";
import { createBrowserUserAgentSettings } from "./browser-user-agent-settings.js";
import { createBrowserProxySettings } from "./browser-proxy-settings.js";
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
import { browserPinLimit, groupBrowserTabs, moveBrowserTab, setBrowserTabGroup, setupBrowserTabOrdering, toggleBrowserTabPin } from "./browser-tab-order.js";
import { showBrowserTabGroup } from "./browser-tab-group-dialog.js";
import { showBrowserProfiles } from "./browser-profiles.js";
import { showBrowserDownloads } from "./browser-downloads.js";
import { showBrowserHistory } from "./browser-history.js";
import { browserPermissionKind, blockedPermissionText, showSiteSettings, SITE_SETTINGS_CHANGED } from "./browser-site-settings.js";
import { showBrowserBookmarks } from "./browser-bookmarks.js";
import { createBrowserSurface } from "./browser-surface.js";
import { createBrowserOptions } from "./browser-options.js";
import { createBrowserNewTabShortcuts } from "./browser-new-tab-shortcuts.js";
import { prepareBrowserComparisonDraft, prepareBrowserDraft, verifyReviewedBrowserSources } from "./browser-chat-draft.js";
import { showBrowserCapture } from "./browser-capture-preview.js";
import { createBrowserModelGateway } from "./browser-model-gateway.js";
import { showBrowserReader } from "./browser-reader.js";
import { createBrowserAnalysisArtifacts } from "./browser-analysis-artifact.js";
import { ArtifactGateway } from "../plugins/artifact-gateway.js";
import { NotesGateway } from "../plugins/notes-gateway.js";
import { createBrowserNoteWriter } from "./browser-note-snapshot.js";
import { t } from "../../i18n.js";

export function setupBrowserApp({ invoke = globalThis.__TAURI__?.core?.invoke,
  listen = globalThis.__TAURI__?.event?.listen, nativeWindow = globalThis.__TAURI__?.window?.getCurrentWindow?.(), notify = () => {}, getTarget = () => null, onPrepareDraft, canOpenDraftConversation, openDraftConversation, onTranslateSelection, modelGateway } = {}) {
  let startupState, searchSettings, ordering, tabStripControls, tabMenu, tabSearch, pageControls, find, shortcuts, fullscreen;
  let refreshOpenPageControls, siteSettingsPanel, libraryPanel, readerPanel;
  let panelGeneration = 0;
  let root, viewport, assistant, read, tabsHost, address, addressEditor, status, startup, strip, reloadButton, bookmarkButton;
  let tabs = [], closedTabs = [], active = null, revision = 0, visible = false;
  let initialized = false, initPromise, lastSurface = "", surfaceError = "", saveTail = Promise.resolve();
  let savedStartupMode, startupWrites = Promise.resolve(), startupChoice = 0, startupModeError = "";
  let shortcutSurface, openingLocalPdf = false;
  let developerToolsPending = false, developerToolsError = "", refreshDeveloperTools;
  let actionTail = Promise.resolve(), restoreError = "", statusMessage = "";
  let requestedBlankTab = null, openingBlankTab = null;
  const enqueue = work => { const result = actionTail.then(work); actionTail = result.catch(report); return result; };
  const act = work => enqueue(work).catch(() => {});
  let saveTimer;
  const nativeTabs = new Set();
  const crashedTabs = new Set();
  const pendingSuspensions = new Set();
  const pageAvailable = id => nativeTabs.has(id) && !crashedTabs.has(id);
  const pendingZoom = new Set();
  const historyStates = new Map();
  const historyButtons = new Map();
  let refreshNavigationLanguage;
  const favicons = new Map();
  const creatingTabs = new Map();
  const creatingPopups = new Map();
  const navigationStates = new Map();
  const waitingDownloads = new Set();
  const downloadObservers = new Set();
  const pageVersions = new Map();
  const documentRevisions = new Map();
  const blockedPermissions = new Map();
  const pdfDocuments = new Map();
  const readerPositions = new Map();
  const questionDrafts = new Map();
  let captureDismissals = 0;
  const questionScope = () => {
    const { sceneId, workspaceId, instanceId, sessionId } = getTarget() ?? {};
    return JSON.stringify([sceneId, workspaceId, instanceId, sessionId]);
  };
  const closePageAssistant = restoreFocus => assistant?.firstElementChild?.invalidateBrowserCapture?.(restoreFocus);
  const control = request => invoke("browser_control", { request });
  const surface = createBrowserSurface(control);
  const paintStatus = () => {
    if (!status) return;
    const failure = crashedTabs.has(active) ? t("The page process stopped. Unsaved page input may be lost. Reload to reopen the address.")
      : navigationStates.get(active) === "failed" ? t("Page could not be loaded") : "";
    const message = (statusMessage === restoreError ? "" : statusMessage) ||
      blockedPermissionText(blockedPermissions.get(active));
    const text = [message, failure].filter(Boolean).join(" ");
    if (status.textContent !== text) status.textContent = text;
  };
  const setStatus = message => { statusMessage = message; paintStatus(); };
  const report = error => setStatus(String(error?.message ?? error));
  const run = work => Promise.resolve().then(work).catch(report);
  function chooseStartupMode(mode) {
    if (!savedStartupMode || (mode !== "browser" && mode !== "workspace")) return;
    const choice = ++startupChoice;
    startupWrites = startupWrites.then(async () => {
      if (choice !== startupChoice) return;
      try {
        if (mode !== savedStartupMode) {
          await invoke("browser_set_startup_mode", { mode });
          savedStartupMode = mode;
        }
        if (choice !== startupChoice) return;
        if (startupModeError && statusMessage === startupModeError) setStatus("");
        startupModeError = "";
      } catch {
        if (choice !== startupChoice) return;
        startup.value = savedStartupMode;
        startupModeError = t("Startup mode could not be saved. Your previous choice was kept.");
        report(startupModeError);
      }
    });
  }
  const browserWindow = observeBrowserWindow(nativeWindow, () => void run(syncSurface));
  const selected = () => tabs.find(tab => tab.id === active);
  const listWebsiteShortcuts = async () => (await invoke("browser_bookmarks", { request: { kind: "list" } })).bookmarks.filter(item => item.shortcut);
  const newTabShortcuts = createBrowserNewTabShortcuts({
    list: listWebsiteShortcuts,
    open: (item, source) => void act(async () => {
      if (shortcutTab() !== source || blocked()) return;
      const submission = addressEditor.submission(item.url);
      if (!submission) return;
      await navigate(submission, source);
      await syncSurface();
    }),
    manage: () => void act(() => openBookmarks(false)),
    add: source => void act(() => {
      if (shortcutTab() === source && !blocked()) return openBookmarks(false, source, { shortcut: true });
    }),
    onChange: () => void run(syncSurface),
  });
  function shortcutTab() {
    const tab = selected();
    return visible && tab?.url === "about:blank" && !tab.popupOpener &&
      !crashedTabs.has(tab.id) && !navigationStates.has(tab.id) &&
      !root.hasAttribute("data-private-browser") ? tab.id : null;
  }
  function bounds() {
    const r = viewport.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  const overlayOpen = browserOverlayOpen;
  const preview = createBrowserOverlayPreview({ capture: tab => control({ kind: "snapshot", tab }), host: () => viewport,
    current: tab => visible && selected()?.id === tab && root?.isConnected });
  const surfaceUnavailable = () => browserWindow.minimized || document.hidden || !visible ||
    !root?.isConnected || root.closest("[inert],.plugin-surface-hidden");
  const blocked = () => surfaceUnavailable() || overlayOpen();
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
    if (preserve && selected() && pageAvailable(active) && lastSurface) {
      const tab = active;
      try {
        // A pending present may still have the previous WebView on screen.
        await surface.settled();
        if (!lastSurface || active !== tab || !stillNeeded()) return;
        if (!await preview.show(tab)) return;
      } catch (error) { if (active === tab && stillNeeded()) report(error); }
      if (active !== tab || !stillNeeded()) {
        void preview.releaseWhenPresented(() => !blocked() && Boolean(lastSurface));
        return;
      }
      if (!lastSurface) return;
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
    const shortcut = shortcutTab();
    if (shortcutSurface?.tab !== shortcut) shortcutSurface = undefined;
    newTabShortcuts.select(shortcut);
    const r = bounds();
    if (!selected()) finishStartup();
    if (blocked() || r.width < 1 || r.height < 1 || !selected()) {
      if (lastSurface) await hide(!browserWindow.minimized && overlayOpen(), () => blocked());
      return;
    }
    if (crashedTabs.has(active)) {
      if (lastSurface) await hide();
      finishStartup();
      return;
    }
    try {
      if (newTabShortcuts.ready(shortcut)) {
        // A restored tab can already be visible before this frontend presents it.
        if (!shortcutSurface || lastSurface) shortcutSurface = { tab: shortcut, hidden: hide() };
        await shortcutSurface.hidden;
        if (!blocked() && shortcutTab() === shortcut && newTabShortcuts.ready(shortcut)) {
          preview.clear();
          newTabShortcuts.show(viewport);
          finishStartup();
        }
        return;
      }
      shortcutSurface = undefined;
      newTabShortcuts.clear();
      const tab = selected();
      await ensureView(tab);
      const current = () => !blocked() && selected()?.id === tab.id &&
        !crashedTabs.has(tab.id) && !newTabShortcuts.ready(shortcutTab());
      if (!current()) return;
      const key = JSON.stringify([tab.id, bounds()]);
      if (key === lastSurface) return;
      lastSurface = key;
      await withBrowserViewportRetry(() => surface.send({ kind: "present", tab: tab.id, bounds: bounds(), focus: false }), current);
      if (!current()) return;
      if (surfaceError && statusMessage === surfaceError) setStatus("");
      surfaceError = "";
      void preview.releaseWhenPresented(() => current() && lastSurface === key);
      finishStartup();
    } catch (error) {
      if (shortcutSurface?.tab === shortcut) shortcutSurface = undefined;
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
    const snapshot = nextTabs.filter(tab => !tab.popupOpener && !tab.localPdf).map(({ id, url, title, zoom = 1, muted = false, pinned, group }) => ({
      id, url, title, zoom, muted, ...(pinned ? { pinned: true } : {}), ...(group ? { group } : {}),
    }));
    const selectedTab = nextTabs.find(tab => tab.id === nextActive);
    const opener = selectedTab?.popupOpener ?? selectedTab?.localPdfOpener;
    const activeTab = selectedTab?.localPdf || opener
      ? snapshot.find(tab => tab.id === opener)?.id ?? snapshot[0]?.id ?? null : nextActive;
    // A failed write must not poison every subsequent retry.
    saveTail = saveTail.catch(() => {}).then(async () => {
      const result = await invoke("browser_save_session", { expectedRevision: revision, tabs: snapshot, activeTab });
      revision = result.revision; closedTabs = result.closedTabs ?? [];
    });
    return saveTail;
  }
  function save() { return persist(tabs, active); }
  async function ensureView(tab) {
    if (crashedTabs.has(tab.id) || nativeTabs.has(tab.id)) return;
    if (creatingTabs.has(tab.id)) return creatingTabs.get(tab.id);
    const popupRequest = tab.popupRequest;
    if (popupRequest) creatingPopups.set(tab.id, tab);
    const creation = createHiddenBrowserView(initialBounds => control({
      kind: "create", tabId: tab.id, url: tab.url, bounds: initialBounds, zoom: tab.zoom ?? 1, muted: tab.muted ?? false,
      ...(popupRequest ? { popupRequest } : {}),
    }), bounds()).then(async () => {
      nativeTabs.add(tab.id);
      refreshDeveloperTools?.();
      await control({ kind: "menuLanguage", chinese: t("Find in page") !== "Find in page" });
    }).finally(() => { creatingTabs.delete(tab.id); creatingPopups.delete(tab.id); });
    creatingTabs.set(tab.id, creation);
    return creation;
  }
  function developerToolsState() {
    if (developerToolsPending) return { description: t("Opening developer tools…") };
    const tab = selected();
    if (!tab || tab.localPdf || !/^https?:/.test(tab.url) || !URL.canParse(tab.url)) {
      return { description: t("Open a webpage to use developer tools.") };
    }
    const { id, url } = tab;
    const navigation = navigationStates.get(id);
    if (crashedTabs.has(id) || navigation === "failed") {
      return { description: t("Reload this page to use developer tools.") };
    }
    const revision = documentRevisions.get(id);
    if (!pageAvailable(id) || navigation || !revision) {
      return { description: t("Wait for the current page to finish loading") };
    }
    return { target: { id, url, revision, version: pageVersions.get(id) }, description: new URL(url).host };
  }
  function clearDeveloperToolsError() {
    if (developerToolsError && statusMessage === developerToolsError) setStatus("");
    developerToolsError = "";
  }
  function openDeveloperTools() {
    const { target } = developerToolsState();
    if (!target || blocked()) return;
    const { id, url, revision, version } = target;
    const sameDocument = () => active === id && selected()?.url === url &&
      documentRevisions.get(id) === revision && pageVersions.get(id) === version;
    developerToolsPending = true;
    clearDeveloperToolsError();
    refreshDeveloperTools?.();
    return act(async () => {
      try {
        if (blocked() || !sameDocument()) return;
        await syncSurface();
        await surface.settled();
        if (blocked() || !sameDocument()) return;
        await control({ kind: "openDeveloperTools", tab: id, expectedUrl: url, expectedDocumentRevision: revision });
      } catch (error) {
        if (surfaceUnavailable() || !sameDocument()) return;
        const reason = String(error?.message ?? error);
        const known = reason === "Browser page changed" || reason === "Browser page is not visible";
        developerToolsError = t(known ? reason : "Could not open developer tools for this page.");
        setStatus(developerToolsError);
      }
    }).finally(() => {
      developerToolsPending = false;
      refreshDeveloperTools?.();
    });
  }
  function outputDocument(id) {
    const page = selected(), documentRevision = documentRevisions.get(id);
    if (!page || page.localPdf || page.id !== id || !pageAvailable(id) || navigationStates.has(id) ||
        !/^https?:/.test(page.url) || !documentRevision) return null;
    return { tab: id, expectedUrl: page.url, expectedDocumentRevision: documentRevision };
  }
  function outputIsCurrent(expected) {
    if (blocked() || active !== expected.tab) return false;
    const current = outputDocument(expected.tab);
    if (current?.expectedUrl === expected.expectedUrl &&
        current.expectedDocumentRevision === expected.expectedDocumentRevision) return true;
    setStatus(t("Browser page changed"));
    return false;
  }
  function queuePrint(id) {
    if (selected()?.localPdf) { setStatus(t("Studio exports and printing are unavailable for local PDFs.")); return; }
    const expected = outputDocument(id);
    if (!expected) {
      setStatus(t("Wait for the current page to finish loading"));
      return;
    }
    const generation = panelGeneration;
    const current = () => generation === panelGeneration && outputIsCurrent(expected);
    return act(async () => {
      if (!current()) return;
      await syncSurface();
      await surface.settled();
      if (!current()) return;
      try { await control({ kind: "printPage", ...expected }); }
      catch (error) {
        if (generation === panelGeneration) report(t(String(error?.message ?? error)));
      }
    });
  }
  async function runPageAction(action, source) {
    if (!source || active !== source || blocked()) return;
    if (crashedTabs.has(source)) {
      if (action === "reload") {
        const tab = selected();
        if (tab?.popupOpener) await close(source);
        else if (tab) await reopenCrashedTab(tab);
      }
      return;
    }

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
      const changed = active !== id;
      tabs = next; active = id;
      if (changed) closePageAssistant();
      setStatus(""); paint();
      if (changed) refreshOpenPageControls?.();
      if (!background) {
        await find.close();
        await syncSurface();
      }
    },
    discard: discardTabView,
  });
  const select = activation.select;
  function blankTabRequest() {
    return { id: crypto.randomUUID(), addressVersion: addressEditor.editVersion };
  }
  function queueBlankTab(current = () => true) {
    const previous = requestedBlankTab?.id;
    const request = blankTabRequest();
    requestedBlankTab = request;
    return enqueue(async () => {
      if (current(previous)) await add(request);
      else if (requestedBlankTab === request) requestedBlankTab = null;
    });
  }
  async function add(request = blankTabRequest()) {
    requestedBlankTab ??= request;
    openingBlankTab = request.id;
    try {
      await activation.add({ id: request.id, url: "about:blank", title: t("New tab") });
      if (requestedBlankTab === request && document.activeElement !== address) {
        address.focus(); address.select();
      }
    } finally {
      openingBlankTab = null;
      if (requestedBlankTab === request) requestedBlankTab = null;
    }
  }
  function openLocalPdf(returnFocus, source = selected()?.id, fromPage = false) {
    const current = () => initialized && !blocked() && selected()?.id === source &&
      (!fromPage || pageAvailable(source));
    if (openingLocalPdf || !current()) return;
    openingLocalPdf = true;
    return act(async () => {
      const id = crypto.randomUUID();
      try {
        if (!current()) return;
        const opening = control({ kind: "openLocalPdf", tab: id });
        creatingTabs.set(id, opening);
        const file = await opening;
        if (!file) {
          if (!current()) return;
          if (fromPage) await control({ kind: "focusPage", tab: source });
          else if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
          return;
        }
        nativeTabs.add(id);
        if (!current() || crashedTabs.has(id)) {
          await discardTabView(id);
          return;
        }
        await activation.add({ id, url: file.url, title: file.name, localPdf: true, localPdfOpener: source });
        tabStripControls.focusTab(id);
      } finally {
        creatingTabs.delete(id);
        openingLocalPdf = false;
      }
    });
  }
  async function discardTabView(id, reopening = false) {
    questionDrafts.delete(id);
    if (nativeTabs.has(id)) {
      await control({ kind: "close", tab: id });
      nativeTabs.delete(id);
    }
    crashedTabs.delete(id);
    navigationStates.delete(id);
    documentRevisions.delete(id);
    blockedPermissions.delete(id);
    pdfDocuments.delete(id);
    readerPositions.delete(id);
    historyStates.delete(id);
    if (!reopening) pageVersions.delete(id);
    favicons.delete(id);
  }
  function recordCrash(id) {
    const tab = tabs.find(item => item.id === id) ?? creatingPopups.get(id);
    if (crashedTabs.has(id) || (!tab && !creatingTabs.has(id))) return;
    crashedTabs.add(id);
    questionDrafts.delete(id);
    navigationStates.delete(id);
    documentRevisions.delete(id);
    blockedPermissions.delete(id);
    pdfDocuments.delete(id);
    readerPositions.delete(id);
    historyStates.delete(id);
    favicons.delete(id);
    pageVersions.set(id, (pageVersions.get(id) ?? 0) + 1);
    if (id === active) {
      closePageAssistant(true);
      lastSurface = "";
      preview.clear();
      void find.close({ stopNative: false });
    }
    paint();
    if (tab?.popupOpener || tab?.popupRequest || tab?.localPdf) void act(() => close(id));
  }
  async function reopenCrashedTab(tab, url = tab.url) {
    // Create a fresh navigation. Native Reload could replay the crashed request.
    await discardTabView(tab.id, true);
    try {
      await ensureView({ ...tab, url });
    } catch (error) {
      recordCrash(tab.id);
      throw error;
    }
    if (crashedTabs.has(tab.id)) return;
    await syncSurface();
    setStatus("");
    paint();
  }
  async function suspendBackgroundTab(tab) {
    if (active === tab.id || !pageAvailable(tab.id) || blocked() || pendingSuspensions.has(tab)) return;
    pendingSuspensions.add(tab);
    const current = () => tabs.includes(tab) && active !== tab.id && pageAvailable(tab.id) && !blocked();
    try {
      // Keep the tab action queue free while WebView2 decides whether it can suspend.
      const result = await control({ kind: "suspend", tab: tab.id });
      if (current()) setStatus(result.suspended ? t("Background tab suspended") : t("The browser kept this tab awake"));
    } catch (error) {
      if (current()) report(t(String(error?.message ?? error)));
    } finally {
      pendingSuspensions.delete(tab);
    }
  }
  async function close(id) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const { popupOpener, localPdfOpener, localPdf } = tabs[index];
    const transient = popupOpener || localPdf;
    // Flush current URL/title before the Host records a durable tab's removal.
    if (!transient) await save();
    const wasActive = active === id;
    const nextTabs = tabs.filter(tab => tab.id !== id);
    const fallback = nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? null;
    const nextActive = wasActive ? nextTabs.find(tab => tab.id === (popupOpener ?? localPdfOpener))?.id ?? fallback : active;
    if (!transient) await persist(nextTabs, nextActive);
    tabs = nextTabs;
    active = nextActive;
    if (wasActive) closePageAssistant();
    setStatus("");
    paint();
    if (wasActive) {
      refreshOpenPageControls?.();
      await find.close();
    }
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
    if (action === "closeTab" && source) await close(source);
    else if (action === "reopenTab") await reopen();
    else if (numberedTab) await select(numberedTab.id);
    else if (["nextTab", "previousTab"].includes(action) && tabs.length > 1) {
      const index = tabs.findIndex(tab => tab.id === source), offset = action === "nextTab" ? 1 : -1;
      await select(tabs[(index + offset + tabs.length) % tabs.length].id);
    }
    if (!blocked() && selected() && pageAvailable(active)) await control({ kind: "focusPage", tab: active });
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
  async function focusPdfReader(id, current) {
    const canFocus = () => current() && active === id && pageAvailable(id) && !blocked();
    if (!canFocus()) return;
    setStatus(t("Use the PDF toolbar for zoom."));
    await syncSurface();
    await surface.settled();
    if (canFocus()) await control({ kind: "focusPage", tab: id });
  }
  function pdfRevision(id) {
    const revision = pdfDocuments.get(id);
    return revision && documentRevisions.get(id) === revision ? revision : undefined;
  }
  function applyPdfDocument(id, revision) {
    if (!revision || documentRevisions.get(id) !== revision || pdfRevision(id) === revision) return;
    pdfDocuments.set(id, revision);
    if (id !== active) return;
    refreshOpenPageControls?.();
    find.refreshMatchControls();
  }
  async function changePageSettings(id, change) {
    const tab = tabs.find(tab => tab.id === id); if (!tab || !pageAvailable(id)) throw new Error(t("Browser tab is no longer available"));
    const version = pageVersions.get(id);
    const before = await control({ kind: "pageSettings", tab: id });
    const setting = typeof change === "function" ? change(before) : change;
    if (setting.kind === "zoom" && (before.pdfDocument === true || pdfRevision(id))) {
      await focusPdfReader(id, () => pageVersions.get(id) === version);
      return;
    }
    await applyBrowserPageSetting({ change: setting,
      read: () => before,
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
      if (!tab || !pageAvailable(id)) return;
      // The event is a notification. A newer wheel or keyboard action may
      // already have changed the live zoom before this work starts.
      const after = await control({ kind: "pageSettings", tab: id });
      const saved = tab.zoom ?? 1;
      if (after.pdfDocument === true || after.zoom === saved) return;
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
    const available = !tab?.popupOpener && !tab?.localPdf;
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
  function paintReloadControl() {
    const loading = navigationStates.get(active) === "loading";
    reloadButton.textContent = loading ? "×" : "↻";
    const reloadLabel = t(loading ? "Stop loading" : "Reload");
    reloadButton.title = loading ? reloadLabel : `${reloadLabel} (F5, Ctrl+R)`;
    reloadButton.setAttribute("aria-label", reloadLabel);
    if (loading) reloadButton.removeAttribute("aria-keyshortcuts");
    else reloadButton.setAttribute("aria-keyshortcuts", "F5 Control+r");
  }
  function paint() {
    if (siteSettingsPanel && !siteSettingsPanel.current()) siteSettingsPanel.panel.invalidate();
    paintStatus();
    paintHistoryControls();
    refreshDeveloperTools?.();
    read.disabled = selected()?.localPdf === true;
    bookmarkButton.disabled = selected()?.localPdf || !/^https?:/.test(selected()?.url ?? "");
    paintReloadControl();
    const focusedTab = tabStripControls.focusedControl();
    if (!ordering.dragging) {
    tabsHost.replaceChildren();
    for (const tab of tabs) {
      const item = document.createElement("div"); item.className = "browser-tab";
      const button = makeButton(tab.title || tab.url, () => select(tab.id));
      button.setAttribute("role", "tab"); button.setAttribute("aria-selected", String(tab.id === active));
      button.title = tab.localPdf ? tab.title : tab.url; button.classList.add("browser-tab-title");
      button.setAttribute("aria-label", tab.title || tab.url);
      if (tab.pinned) {
        item.dataset.pinned = "";
        button.title = tab.title || tab.url;
        button.setAttribute("aria-label", `${tab.title || tab.url} (${t("Pinned tab")})`);
      }
      const label = document.createElement("span"); label.className = "browser-tab-label"; label.textContent = tab.title || tab.url;
      button.replaceChildren(createBrowserTabIcon(tab.localPdf ? "about:blank" : tab.url, favicons.get(tab.id)), label);
      if (tab.group) {
        item.dataset.tabGroup = tab.group.id;
        const prefix = document.createElement("span");
        prefix.className = "browser-tab-group-name";
        prefix.textContent = tab.group.name;
        label.prepend(prefix);
        button.title = `${tab.group.name} · ${tab.title || tab.url}`;
        button.setAttribute("aria-label", button.title);
      }
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
    const page = selected();
    // Preserve a draft for the requested blank tab across earlier queued blank-tab commits.
    const addressVersion = openingBlankTab === page?.id ? requestedBlankTab?.addressVersion : undefined;
    addressEditor.sync(page?.localPdf ? { ...page, url: "" } : page, addressVersion);
    if (!tabs.length) { preview.clear(); viewport.textContent = t("Open a new tab to browse"); }
    else if (!startupState.pending() && !viewport.querySelector(".browser-overlay-preview, .browser-new-tab-shortcuts")) viewport.textContent = "";
  }
  function makeButton(label, action) {
    const button = document.createElement("button"); button.type = "button";
    button.className = "ui-button ui-button--ghost"; button.textContent = label;
    if (action) button.addEventListener("click", () => act(action));
    return button;
  }
  function failStartup() {
    restoreError = t("Could not restore the browser. Your saved tabs are kept. Please retry.");
    startupState.fail(restoreError); report(restoreError); return new Error(restoreError);
  }
  function restore() { return initialize().catch(() => { failStartup(); }); }
  async function initialize() {
    if (initialized) { await syncSurface(); return; }
    if (!invoke) { const message = t("Browser is available in the Windows desktop app"); setStatus(message); startupState.fail(message, false); return; }
    // Subscribe before the snapshot so an existing tab cannot finish loading unseen.
    const pendingEvents = [];
    let handleEvent;
    const subscription = listen?.("zicode:browser-event", event => {
      if (handleEvent) handleEvent(event);
      else pendingEvents.push(event);
    });
    const nativeStatus = () => control({ kind: "status" });
    let stored, live;
    try {
      [stored, live] = await Promise.all([
        invoke("browser_get_state"),
        subscription ? Promise.resolve(subscription).then(nativeStatus) : nativeStatus(),
      ]);
    } catch (error) {
      if (subscription) void Promise.resolve(subscription).then(unlisten => unlisten?.()).catch(() => {});
      throw error;
    }
    revision = stored.session.revision; surface.seed(live.surfaceRevision);
    tabs = groupBrowserTabs(stored.session.tabs.map(tab => ({ zoom: 1, muted: false, ...tab }))); active = stored.session.activeTab; closedTabs = stored.session.closedTabs ?? [];
    const recentlyClosed = new Set(closedTabs.map(entry => entry.tab.id));
    for (const { documentRevision, pdfDocument, ...tab } of live.tabs) {
      const saved = tabs.find(item => item.id === tab.id);
      if (tab.processFailed && saved) {
        nativeTabs.add(tab.id);
        crashedTabs.add(tab.id);
        continue;
      }
      if (tab.localPdf || recentlyClosed.has(tab.id) || tab.processFailed) {
        // A shell reload can interrupt native cleanup after a committed close.
        await control({ kind: "close", tab: tab.id }).catch(report);
        continue;
      }
      nativeTabs.add(tab.id);
      if (documentRevision) {
        documentRevisions.set(tab.id, documentRevision);
        if (pdfDocument === true) pdfDocuments.set(tab.id, documentRevision);
      }
      if (tab.history) historyStates.set(tab.id, tab.history);
      if (tab.favicon) favicons.set(tab.id, tab.favicon);
      if (saved) { saved.url = tab.url; if (typeof tab.title === "string") saved.title = tab.title || (tab.url === "about:blank" ? t("New tab") : ""); if (tab.settings) Object.assign(saved, tab.settings); } else tabs.push({ ...tab, title: tab.url });
    }
    const visiblePopup = live.tabs.find(tab => tab.popupOpener && tab.visible);
    if (visiblePopup && tabs.some(tab => tab.id === visiblePopup.id)) active = visiblePopup.id;
    active ??= tabs[0]?.id ?? null;
    savedStartupMode = stored.startupMode === "workspace" ? "workspace" : "browser";
    startup.value = savedStartupMode;
    startup.disabled = false;
    const identity=root.querySelector(".browser-profile-identity");
    identity.textContent=stored.private?t("Private browsing"):stored.profileName??"";
    identity.hidden=!identity.textContent;
    root.toggleAttribute("data-private-browser",stored.private===true);
    verticalTabs = stored.verticalTabs === true;
    placeTabStrip();
    searchSettings.initialize(stored.searchEngine);
    handleEvent = ({ payload }) => {
      if (payload.kind === "processFailed") { recordCrash(payload.tab); return; }
      if (payload.tab && crashedTabs.has(payload.tab)) return;
      if (payload.kind === "contextAction") {
        const source = payload.action === "reader" ? readerSource() : null;
        if (payload.tab === active && !blocked()) act(async () => {
          if (payload.tab !== active || blocked()) return;
          if (["back", "forward", "reload", "zoomIn", "zoomOut", "zoomReset"].includes(payload.action)) await runPageAction(payload.action, payload.tab);
          else if (payload.action === "find") { await control({ kind: "focusChrome", tab: active }); find.open({ fromPage: true }); }
          else if (payload.action === "bookmark") await openBookmarks(true);
          else if (payload.action === "bookmarks") await openBookmarks(false);
          else if (payload.action === "history") await openHistory();
          else if (payload.action === "downloads") await openDownloads();
          else if (payload.action === "read") await readPage();
          else if (payload.action === "reader") await openReader(source);
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
            if (tab && pageAvailable(tab.id)) {
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
      if (payload.kind === "pdfDocument") {
        applyPdfDocument(payload.tab, payload.documentRevision);
        return;
      }
      if (payload.kind === "navigationStarted" || payload.kind === "navigationFinished") {
        const id = payload.tab;
        // Restored tabs and links can start loading before their tab is saved.
        if (!tab && !creatingTabs.has(id) && !nativeTabs.has(id)) return;
        if (payload.kind === "navigationStarted") {
          navigationStates.set(id, "loading");
          questionDrafts.delete(id);
          documentRevisions.delete(id);
          blockedPermissions.delete(id);
          pdfDocuments.delete(id);
          readerPositions.delete(id);
          if (tab) pageVersions.set(id, (pageVersions.get(id) ?? 0) + 1);
          if (id === active) {
            closePageAssistant(true);
            if (!tabSearch?.open) preview.clear();
            if (statusMessage === t("Use the PDF toolbar for zoom.")) setStatus("");
            clearDeveloperToolsError();
            void find.close();
          }
        } else {
          if (payload.documentRevision) documentRevisions.set(id, payload.documentRevision);
          if (!payload.success && !payload.canceled && navigationStates.get(id) !== "stopping") navigationStates.set(id, "failed");
          else navigationStates.delete(id);
        }
        if (id === active) {
          paint();
          refreshOpenPageControls?.();
        }
        return;
      }
      if (!tab) {
        const preparing = creatingPopups.get(payload.tab);
        if (preparing && payload.kind === "title") preparing.title = payload.title;
        if (preparing && (payload.kind === "loading" || (payload.kind === "visited" && payload.sameDocument))) preparing.url = payload.url;
        return;
      }
      if (payload.kind === "permissionBlocked") {
        if (!(pageAvailable(tab.id) || creatingTabs.has(tab.id)) || !Number.isInteger(payload.permission_kind)) return;
        const permission = browserPermissionKind(payload.permission_kind);
        const kinds = blockedPermissions.get(tab.id) ?? new Set();
        if (kinds.has(permission)) return;
        kinds.add(permission);
        blockedPermissions.set(tab.id, kinds);
        if (tab.id === active) {
          paintStatus();
          if (siteSettingsPanel?.current()) siteSettingsPanel.panel.setBlockedPermissions(kinds);
        }
        return;
      }
      if (payload.kind === "favicon") {
        if (payload.image) favicons.set(tab.id, payload.image); else favicons.delete(tab.id);
        const row = [...tabsHost.children].find(row => row.dataset.browserTabId === tab.id);
        row?.querySelector(".browser-tab-icon")?.replaceWith(createBrowserTabIcon(tab.url, favicons.get(tab.id)));
        return;
      }
      if (payload.kind === "title" && !tab.localPdf) tab.title = payload.title;
      const routeChanged = payload.kind === "visited" && payload.sameDocument;
      if (routeChanged && tab.id === active) clearDeveloperToolsError();
      if (payload.kind === "loading" || routeChanged) {
        tab.url = payload.url;
        pageVersions.set(tab.id, (pageVersions.get(tab.id) ?? 0) + 1);
        questionDrafts.delete(tab.id);
        if (tab.id === active) closePageAssistant(true);
      }
      if (routeChanged || ["title", "loading"].includes(payload.kind)) {
        paint();
        if (!tab.popupOpener && !tab.localPdf) { clearTimeout(saveTimer); saveTimer = setTimeout(() => void act(save), 150); }
      }
      if (payload.kind.endsWith("Blocked")) setStatus(t("This browser action is not available yet"));
    };
    initialized = true;
    for (const event of pendingEvents) handleEvent(event);
    pendingEvents.length = 0;
    const menuLanguage = () => { if (nativeTabs.size) void control({ kind: "menuLanguage", chinese: t("Find in page") !== "Find in page" }).catch(report); };
    window.addEventListener("zicode:locale-changed", () => {
      menuLanguage();
      refreshNavigationLanguage?.();
      find.refreshMatchControls();
      paintStatus();
      if (siteSettingsPanel?.current()) siteSettingsPanel.panel.setBlockedPermissions(blockedPermissions.get(active));
      refreshDeveloperTools?.();
    });
    menuLanguage(); refreshNavigationLanguage?.(); paint();
    await syncSurface();
  }
  let tabLayoutInput, pageBody, verticalTabs = false;
  function placeTabStrip() {
    tabsHost.setAttribute("aria-orientation", verticalTabs ? "vertical" : "horizontal");
    strip.classList.toggle("browser-tab-strip--vertical", verticalTabs);
    tabLayoutInput.checked = verticalTabs;
    if (!visible) return;
    strip.hidden = false;
    if (verticalTabs) pageBody.prepend(strip);
    else {
      const header = document.getElementById("page-header-actions");
      if (header) header.append(strip);
      else root.prepend(strip);
    }
    tabStripControls.refresh(true);
  }
  function mount() {
    root = document.createElement("section"); root.className = "studio-browser";
    strip = document.createElement("div"); strip.className = "browser-tab-strip";
    strip.dataset.pageHeaderOwner = "com.zicode.browser";
    tabsHost = document.createElement("div"); tabsHost.className = "browser-tabs"; tabsHost.setAttribute("role", "tablist"); tabsHost.setAttribute("aria-label", t("Browser tabs"));
    ordering = setupBrowserTabOrdering(tabsHost, { onMove: change => void act(() => reorder(change)), onFinish: paint });
    const newTab = makeButton("+");
    newTab.addEventListener("click", () => void queueBlankTab().catch(() => {}));
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
        if (available && !pinned) actions.push({ label: "Tab group", action: () => act(() => editTabGroup(id)) });
        if (pageAvailable(id)) actions.push({
          label: tab.muted ? "Unmute tab" : "Mute tab",
          action: () => act(() => changePageSettings(id, { kind: "muted", value: !tab.muted })),
        });
        if (id !== active && !tab.popupOpener && pageAvailable(id)) actions.push({
          label: "Suspend background tab",
          action: () => void suspendBackgroundTab(tab),
          disabled: pendingSuspensions.has(tab),
          hint: "Timers pause until you select this tab again",
        });
        if (!tab.localPdf && /^https?:/.test(tab.url)) {
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
    for (const [action, glyph] of [["back", "←"], ["forward", "→"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-button ui-button--ghost";
      button.textContent = glyph;
      const shortcut = action === "back" ? "ArrowLeft" : "ArrowRight";
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
    nav.append(reloadButton);
    address = document.createElement("input"); address.className = "ui-input browser-address";
    address.spellcheck = false;
    addressEditor = createBrowserAddressEditor(address);
    const go = document.createElement("button");
    go.type = "submit"; go.className = "ui-button ui-button--ghost browser-go"; go.dataset.i18nText = "Go";
    nav.append(address, go);
    const identity=document.createElement("span");identity.className="browser-profile-identity";identity.hidden=true;nav.append(identity);
    nav.addEventListener("submit", event => {
      event.preventDefault();
      const submission = addressEditor.submission();
      const request = requestedBlankTab;
      if (request && !addressEditor.hasEditedSince(request.addressVersion)) return;
      const source = request?.id ?? active;
      if (submission?.text) void act(() => navigate(submission, source));
    });
    const footer = document.createElement("div"); footer.className = "browser-footer";
    status = document.createElement("span"); status.setAttribute("role", "status");
    startup = document.createElement("select"); startup.className = "ui-select"; startup.setAttribute("aria-label", t("Start Studio in")); startup.title = t("Start Studio in");
    for (const [value, label] of [["browser", "Browser"], ["workspace", "Workspace"]]) { const option = document.createElement("option"); option.value = value; option.textContent = t(label); startup.append(option); }
    startup.disabled = true;
    startup.addEventListener("change", () => chooseStartupMode(startup.value));
    find = createBrowserFind({ control, getTab: selected, address, available: () => visible && initialized && !blocked() && pageAvailable(active),
      isPdf: tab => Boolean(pdfRevision(tab)), restoreFocus: async (tab, { toAddress, current }) => {
        await syncSurface();
        if (!current()) return;
        if (toAddress && address.isConnected && !address.disabled && !address.closest("[inert],[hidden]")) {
          address.focus({ preventScroll: true });
        }
        else await control({ kind: "focusPage", tab });
      }, report });
    fullscreen = createBrowserFullscreen({ control, report, beforeChange: () => { const menu = root.querySelector(".browser-options"); if (menu) menu.open = false; }, afterChange: () => run(syncSurface) });
    shortcuts = setupBrowserShortcuts({ available: () => visible && initialized && !blocked(), getTab: selected, focusChrome: tab => control({ kind: "focusChrome", tab }), find: () => find.open({ fromPage: true }), address,
      tabAction: (action, source) => action === "newTab"
        ? queueBlankTab(previous => !blocked() && (active === (source ?? null) || active === previous))
        : enqueue(() => tabShortcut(action, source)),
      pageAction: (action, source) => action === "print" ? queuePrint(source) : enqueue(() => runPageAction(action, source)),
      fullscreen: () => fullscreen.toggle(),
      openLocalPdf: (fromPage, source) => openLocalPdf(document.activeElement, source, fromPage),
      localPdfPending: () => openingLocalPdf,
      translateSelection: tab => act(() => translatePageSelection(tab, true)),
      searchTabs: (fromPage, source) => queueTabSearch(options, fromPage, () => !blocked() && selected()?.id === source),
      openPanel: (action, fromPage, source) => act(() => {
        if (blocked() || selected()?.id !== source) return;
        const returnToPage = fromPage ? source : undefined;
        if (action === "bookmark" && nativeTabs.has(source)) return openBookmarks(true, returnToPage);
        if (action === "history") return openHistory(returnToPage);
        if (action === "downloads") return openDownloads(returnToPage);
      }), report });
    pageControls = createBrowserPageControls({ getTab: selected, isPdf: id => Boolean(pdfRevision(id)),
      read: tab => control({ kind: "pageSettings", tab }), change: (tab, change) => enqueue(() => changePageSettings(tab, change)) });
    searchSettings = createBrowserSearchSettings({ save: engine => invoke("browser_set_search_engine", { engine }), report });
    let exportingPage = false;
    const exportPage = (kind, success, pending) => {
      if (selected()?.localPdf) { setStatus(t("Studio exports and printing are unavailable for local PDFs.")); return; }
      if (exportingPage) return;
      const expected = outputDocument(active);
      if (!expected) {
        setStatus(t("Wait for the current page to finish loading"));
        return;
      }
      exportingPage = true;
      void run(async () => {
        try {
          if (!outputIsCurrent(expected)) return;
          // A wrapped status row changes the native viewport in narrow windows.
          const pendingMessage = pending && t(pending);
          if (pendingMessage) setStatus(pendingMessage);
          await syncSurface();
          await surface.settled();
          if (!outputIsCurrent(expected)) {
            if (pendingMessage && statusMessage === pendingMessage) setStatus("");
            return;
          }
          const saved = await control({ kind, ...expected });
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
      if (active && pageAvailable(active)) await control({ kind: "action", tab: active, action: "selectAll" });
    }), { reopen: () => act(reopen), canReopen: () => closedTabs.length > 0, openLocalPdf,
      windows: action => action === "canReopen" ? invoke("browser_window_command", { action }).catch(() => false) :
        action==="profiles" ? act(async()=>{
          if(tabSearch)return;
          const profiles=await invoke("browser_list_profiles");await hide(true);
          if(visible)tabSearch=showBrowserProfiles(profiles,params=>invoke("browser_window_command",params),()=>{tabSearch=null;void run(syncSurface)});
        }) : act(() => invoke("browser_window_command", { action })),
      bookmarks: () => act(() => openBookmarks(false)), downloads: () => act(() => openDownloads()), history: () => act(() => openHistory()), siteSettings: () => {
        const source = readerSource();
        return act(() => openSiteSettings(source));
      }, searchTabs: () => queueTabSearch(options), pageControls, find: () => find.open(), fullscreen, searchSettings,
      reader: () => {
        const source = readerSource();
        return act(() => openReader(source, options.querySelector("summary")));
      },
      translateSelection: onTranslateSelection && (() => {
        const source = active;
        return act(() => translatePageSelection(source));
      }),
      screenshot: () => exportPage("saveScreenshot", "Screenshot saved to Downloads"),
      websiteShortcuts: {
        available: () => !selected()?.localPdf && !root.hasAttribute("data-private-browser"),
        list: listWebsiteShortcuts,
        open: item => void openSavedPage(item).catch(report),
        add: returnFocus => {
          const ownsPage = libraryOwner();
          return act(() => {
            if (ownsPage() && !root.hasAttribute("data-private-browser")) {
              return openBookmarks(false, null, { shortcut: true, returnFocus });
            }
          });
        },
        report,
      },
      userAgentSettings: createBrowserUserAgentSettings(control),
      proxySettings: createBrowserProxySettings(control),
      print: () => queuePrint(active),
      developerTools: { state: developerToolsState, open: openDeveloperTools },
      savePdf: () => exportPage("savePdf", "PDF saved to Downloads", "Preparing page PDF…"),
      pin: { state: pinState, toggle: () => act(togglePin) } });
    refreshDeveloperTools = options.refreshDeveloperTools;
    refreshOpenPageControls = () => { if (options.open) void pageControls.refresh(); };
    const layoutLabel = document.createElement("label");
    tabLayoutInput = document.createElement("input");
    tabLayoutInput.type = "checkbox";
    const layoutText = document.createElement("span");
    layoutText.dataset.i18nText = "Vertical tabs";
    layoutText.textContent = t("Vertical tabs");
    layoutLabel.append(layoutText, tabLayoutInput);
    options.querySelector(".browser-menu-settings").append(layoutLabel);
    tabLayoutInput.addEventListener("change", () => run(async () => {
      tabLayoutInput.disabled = true;
      const vertical = tabLayoutInput.checked;
      try {
        await invoke("browser_set_vertical_tabs", { vertical });
        verticalTabs = vertical;
        if (visible) options.open = false;
      } finally {
        tabLayoutInput.disabled = false;
        placeTabStrip();
        if (visible && initialized) paint();
        if (visible && !options.open) options.querySelector("summary").focus();
      }
    }));
    read = makeButton("", readPage); read.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-read";
    read.title = t("Read page"); read.setAttribute("aria-label", read.title);
    read.setAttribute("data-i18n-title", "Read page");
    read.setAttribute("data-i18n-aria-label", "Read page");
    read.setAttribute("aria-controls", "browser-page-assistant");
    read.setAttribute("aria-expanded", "false");
    read.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h7l2 2h7v16h-7l-2-2H4zM13 5v16M7 7h3M7 11h3M16 9h1M16 13h1"/></svg>';
    bookmarkButton = makeButton("", () => openBookmarks(true)); bookmarkButton.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-bookmark-toggle";
    bookmarkButton.setAttribute("aria-keyshortcuts", "Control+d");
    bookmarkButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/></svg>';
    const downloads = makeButton("", () => openDownloads()); downloads.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-downloads-open";
    downloads.setAttribute("aria-keyshortcuts", "Control+j");
    downloads.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>';
    refreshNavigationLanguage = () => {
      address.setAttribute("aria-label", t("Web address"));
      address.placeholder = t("Search or enter a web address");
      go.textContent = t("Go");
      const controls = [
        [historyButtons.get("back"), "Back", "Alt+←"], [historyButtons.get("forward"), "Forward", "Alt+→"],
        [bookmarkButton, "Bookmark this page", "Ctrl+D"], [downloads, "Downloads", "Ctrl+J"], [newTab, "New tab", "Ctrl+T"],
      ];
      for (const [button, label, shortcut] of controls) {
        const text = t(label);
        button.setAttribute("aria-label", text);
        button.title = `${text} (${shortcut})`;
      }
      paintReloadControl();
    };
    refreshNavigationLanguage();
    footer.append(status, fullscreen.exit, bookmarkButton, read, downloads, options);
    viewport = document.createElement("div"); viewport.className = "browser-viewport";
    const pageArea = document.createElement("div"); pageArea.className = "browser-page-area";
    assistant = document.createElement("aside"); assistant.className = "browser-assistant ui-panel";
    assistant.id = "browser-page-assistant";
    assistant.hidden = true;
    assistant.setAttribute("aria-label", t("Browser assistant"));
    assistant.setAttribute("data-i18n-aria-label", "Browser assistant");
    pageArea.append(viewport, assistant);
    nav.append(footer);
    const filePickerSpace = makeButton(t("Use fullscreen to choose files"), () => fullscreen.toggle());
    filePickerSpace.classList.add("browser-file-picker-space");
    pageBody = document.createElement("div"); pageBody.className = "browser-page-body";
    pageBody.append(pageArea);
    root.append(strip, nav, find.element, filePickerSpace, pageBody);
    startupState = createBrowserStartup({ root, controls: [strip, nav, filePickerSpace], viewport, retry: () => { initPromise = restore(); } });
    new ResizeObserver(() => void run(syncSurface)).observe(viewport);
    document.addEventListener("visibilitychange", () => void run(syncSurface));
    new MutationObserver(() => void run(syncSurface)).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "hidden", "open", "inert", "aria-modal", "style"] });
  }
  async function editTabGroup(id) {
    const tab = tabs.find(item => item.id === id);
    if (!visible || tabSearch || !tab || tab.pinned || tab.popupOpener) return;
    await hide(true);
    if (!visible) return;
    tabSearch = showBrowserTabGroup({
      tab, tabs,
      onSave: group => enqueue(async () => {
        const next = setBrowserTabGroup(tabs, id, group);
        if (next === tabs) throw new Error(t("Browser tab is no longer available"));
        await persist(next, active);
        tabs = next;
        paint();
      }),
      onClose: () => {
        tabSearch = null;
        if (visible) { tabStripControls.focusTab(id); void run(syncSurface); }
      },
    });
  }
  function queueTabSearch(options, fromPage = false, shortcutAvailable) {
    const source = active;
    const generation = panelGeneration;
    return act(() => {
      if (panelGeneration !== generation || active !== source || shortcutAvailable?.() === false) return;
      return openTabSearch(options, fromPage);
    });
  }
  async function openTabSearch(options, fromPage) {
    if (surfaceUnavailable() || tabSearch) return;
    const source = active;
    const generation = panelGeneration;
    const current = () => !surfaceUnavailable() && panelGeneration === generation && active === source;
    const previousFocus = document.activeElement;
    await hide(true, current);
    if (!current()) {
      await syncSurface();
      return;
    }
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
            if (!blocked() && !tabSearch && active === target && pageAvailable(target)) await control({ kind: "focusPage", tab: target });
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
  function restorePanelPage(tab, current = () => true) {
    void run(async () => {
      await syncSurface();
      if (current() && tab && active === tab && !blocked()) {
        if (newTabShortcuts.ready(shortcutTab())) address.focus();
        else if (pageAvailable(tab)) await control({ kind: "focusPage", tab });
      }
    });
  }
  function libraryOwner() {
    const source = readerSource(), generation = panelGeneration;
    return () => !surfaceUnavailable() && panelGeneration === generation && active === (source?.id ?? null) &&
      (!source || (selected()?.url === source.url && pageVersions.get(source.id) === source.version));
  }
  async function openLibrary(ownsPage, show, returnToPage) {
    if (libraryPanel || !ownsPage()) return;
    await hide(true, ownsPage);
    if (!ownsPage()) { await syncSurface(); return; }
    try {
      const panel = show(() => {
        if (libraryPanel !== panel) return;
        libraryPanel = undefined;
        restorePanelPage(returnToPage, ownsPage);
      });
      libraryPanel = panel;
    } catch (error) {
      await syncSurface();
      throw error;
    }
  }
  async function openBookmarks(editCurrent, returnToPage, { shortcut = false, returnFocus } = {}) {
    const ownsPage = libraryOwner();
    if (libraryPanel || !ownsPage()) return;
    const selectedTab = selected();
    const canReadCurrent = selectedTab && !selectedTab.localPdf && pageAvailable(selectedTab.id);
    const needsCurrent = editCurrent || shortcut;
    const readCurrent = async () => {
      if (!ownsPage()) return null;
      const result = await control({ kind: "url", tab: selectedTab.id }).catch(error => {
        if (ownsPage() && needsCurrent) throw error;
        return null;
      });
      if (!ownsPage()) return null;
      const url = typeof result === "string" ? result : result?.url;
      return /^https?:/.test(url) ? { url, title: url === selectedTab.url ? selectedTab.title : url } : null;
    };
    const current = needsCurrent && canReadCurrent ? await readCurrent() : null;
    const currentSource = !needsCurrent && canReadCurrent ? { read: readCurrent, isCurrent: ownsPage } : null;
    await openLibrary(ownsPage, onClose => showBrowserBookmarks({ invoke, current, currentSource, editCurrent, editShortcut: shortcut, onClose: () => {
      if (ownsPage()) {
        newTabShortcuts.refresh();
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      }
      onClose();
    }, onOpen: openSavedPage }), returnToPage);
  }
  function openDownloads(returnToPage) {
    const ownsPage = libraryOwner();
    // The journal and tab session belong to this browser window. Reuse the
    // existing view so switching never reopens a URL or starts a download.
    const getDownloadTab = id => tabs.find(tab => tab.id === id && pageAvailable(id));
    return openLibrary(ownsPage, onClose => showBrowserDownloads({
      invoke, getDownloadTab,
      onSwitchTab: target => {
        const panel = libraryPanel;
        return enqueue(async () => {
          if (panel !== libraryPanel || !panel?.open || !ownsPage() || getDownloadTab(target.id) !== target) {
            return false;
          }
          if (target.id !== active) await select(target.id);
          return true;
        });
      },
      onClose: tab => {
        onClose();
        if (tab && active === tab && !surfaceUnavailable()) tabStripControls.focusTab(tab);
      },
      subscribe: observer => { downloadObservers.add(observer); return () => downloadObservers.delete(observer); },
    }), returnToPage);
  }
  function openHistory(returnToPage) {
    return openLibrary(libraryOwner(), onClose => showBrowserHistory({ invoke, onOpen: openSavedPage, onClose }), returnToPage);
  }
  async function openSiteSettings(source) {
    if (siteSettingsPanel || surfaceUnavailable() || selected()?.localPdf) return;
    if (!source || !pageAvailable(source.id) || navigationStates.has(source.id)) {
      setStatus(t("Wait for the current page to finish loading"));
      return;
    }
    const tab = source.id;
    const current = () => !surfaceUnavailable() && active === tab && selected()?.url === source.url &&
      pageAvailable(tab) && !navigationStates.has(tab) && pageVersions.get(tab) === source.version;
    if (!current()) return;
    const origin = new URL((await tabPage(tab)).url).origin;
    if (!current()) return;
    await hide(true, current);
    if (!current()) { await syncSurface(); return; }
    const panel = showSiteSettings({
      origin,
      blockedPermissions: blockedPermissions.get(tab),
      request: action => {
        if (!current()) throw new Error(SITE_SETTINGS_CHANGED);
        return control({ kind: "siteSettings", tab, expectedOrigin: origin, action });
      },
      onClose: () => {
        if (siteSettingsPanel?.panel === panel) siteSettingsPanel = undefined;
        restorePanelPage(current() ? tab : undefined);
      },
    });
    siteSettingsPanel = { panel, current };
  }
  async function tabPage(id) {
    const tab = tabs.find(item => item.id === id);
    if (!tab) throw new Error(t("Browser tab is no longer available"));
    if (tab.localPdf) throw new Error(t("This browser action is not available yet"));
    const url = pageAvailable(id) ? (await control({ kind: "url", tab: id })).url : tab.url;
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
    let text = "", provenance;
    if (tab && !tab.localPdf && pageAvailable(source) && /^https?:/.test(url)) {
      const version = pageVersions.get(source);
      await syncSurface();
      const { page, documentRevision, capturedAt } = await invoke("browser_read_selection", { tab: source, expectedUrl: url });
      if (blocked() || active !== source || selected()?.url !== url || pageVersions.get(source) !== version) {
        throw new Error(t("Page changed. Read it again."));
      }
      if (page.truncated) throw new Error(t("Select up to 8,192 characters to translate."));
      text = page.text;
      if (text) provenance = { url, title: tab.title || url, capturedAt, documentRevision };
    }
    if (!text && !openEmpty) throw new Error(t("Select text on the webpage first."));
    await onTranslateSelection(text, provenance);
  }
  function readerSource() {
    const tab = selected();
    return tab && { id: tab.id, url: tab.url, version: pageVersions.get(tab.id), generation: panelGeneration };
  }
  async function openReader(source, returnControl) {
    const sameActivation = () => source?.generation === panelGeneration;
    const syncForReader = () => syncSurface().catch(error => {
      if (sameActivation()) throw error;
    });
    if (blocked() || selected()?.localPdf || (source && !sameActivation())) return;
    if (!source || !pageAvailable(source.id) || !/^https?:/.test(source.url) || navigationStates.has(source.id)) {
      throw new Error(t("Wait for the current page to finish loading"));
    }
    const { id, url, version } = source;
    const samePage = () => active === id && selected()?.url === url && pageVersions.get(id) === version && pageAvailable(id);
    await syncForReader();
    if (!sameActivation()) return;
    if (blocked() || !samePage()) throw new Error(t("Page changed. Read it again."));
    const article = await invoke("browser_read_article", { tab: id, expectedUrl: url }).catch(error => {
      if (sameActivation()) throw error;
    });
    if (!sameActivation()) return;
    const { tab, documentRevision, page } = article;
    const sameDocument = () => samePage() && (documentRevisions.get(id) ?? documentRevision) === documentRevision;
    const current = () => sameActivation() && !blocked() && sameDocument();
    if (!current() || tab !== id || page.url !== url || !documentRevision) throw new Error(t("Page changed. Read it again."));
    if (!page.blocks.length) throw new Error(t("No readable text on this page."));
    try {
      await hide(true, current);
      if (!sameActivation()) return;
      if (!current()) throw new Error(t("Page changed. Read it again."));
      const saved = readerPositions.get(id);
      const reader = showBrowserReader(page, position => {
        if (readerPanel === reader) readerPanel = undefined;
        if (sameDocument()) readerPositions.set(id, { documentRevision, position });
        if (!sameActivation()) return;
        const focusedAtClose = document.activeElement;
        void run(async () => {
          await syncForReader();
          if (!current() || document.activeElement !== focusedAtClose) return;
          if (returnControl?.isConnected) returnControl.focus({ preventScroll: true });
          else await control({ kind: "focusPage", tab: id });
        });
      }, saved?.documentRevision === documentRevision ? saved.position : undefined);
      readerPanel = reader;
    } catch (error) {
      if (!sameActivation()) return;
      await syncForReader();
      if (sameActivation()) throw error;
    }
  }
  async function readPage() {
    const tab = selected();
    if (tab?.localPdf || blocked() || assistant.querySelector('[aria-busy="true"]')) return;
    if (!tab || !pageAvailable(tab.id) || !/^https?:/.test(tab.url) || navigationStates.has(tab.id)) {
      throw new Error(t("Wait for the current page to finish loading"));
    }
    const url = tab.url, version = pageVersions.get(tab.id);
    const dismissal = captureDismissals;
    let owner = questionScope();
    const sameDocument = () => active === tab.id && selected()?.url === url &&
      !navigationStates.has(tab.id) && pageVersions.get(tab.id) === version;
    const ensureOpenSource = () => {
      if (blocked() || !sameDocument()) throw new Error(t("Page changed. Read it again."));
      if (questionScope() !== owner) throw new Error(t("Page or conversation changed. Read the page again."));
    };
    let capture, canOpenConversation;
    try {
      capture = await invoke("browser_capture_page", { tab: tab.id, expectedUrl: url });
      if (dismissal !== captureDismissals) return;
      ensureOpenSource();
      if (capture.page.url !== url) throw new Error(t("Page changed. Read it again."));
      canOpenConversation = getTarget()?.runtimeMode === "tools" && await canOpenDraftConversation?.();
      if (dismissal !== captureDismissals) return;
      ensureOpenSource();
    } catch (error) {
      if (dismissal === captureDismissals) throw error;
      return;
    }
    if (assistant.querySelector('[aria-busy="true"]')) return;
    let captureElement;
    // A successful handoff can detach the Browser while Chat becomes active.
    const isCurrent = () => sameDocument() && captureElement?.parentNode === assistant;
    const ownsQuestion = () => isCurrent() && questionScope() === owner;
    const draftKey = () => JSON.stringify([owner, url, capture.documentRevision]);
    const savedQuestions = () => questionDrafts.get(tab.id);
    const clearQuestion = () => {
      const questions = savedQuestions();
      if (!questions) return;
      questions.delete(draftKey());
      if (!questions.size) questionDrafts.delete(tab.id);
    };
    const questionDraft = onPrepareDraft && capture.documentRevision && {
      value: savedQuestions()?.get(draftKey()) ?? "",
      remember(value) {
        if (!ownsQuestion()) return;
        if (!value.trim()) {
          clearQuestion();
          return;
        }
        const questions = savedQuestions() ?? new Map();
        questions.set(draftKey(), value);
        questionDrafts.set(tab.id, questions);
      },
      clear: clearQuestion,
    };
    const openConversation = canOpenConversation && openDraftConversation && (async options => {
      await openDraftConversation(options);
      if (!isCurrent()) throw new Error(t("Page or conversation changed. Read the page again."));
      const questions = savedQuestions(), previous = draftKey();
      owner = questionScope();
      const next = draftKey();
      if (previous !== next && questions?.has(previous) && !questions.has(next)) {
        questions.set(next, questions.get(previous));
        questions.delete(previous);
      }
    });
    const peers = tabs.filter(peer => peer.id !== tab.id && pageAvailable(peer.id) &&
      /^https?:/.test(peer.url) && !navigationStates.has(peer.id)).map(peer => ({
      tab: peer.id, url: peer.url, title: peer.title, version: pageVersions.get(peer.id),
    }));
    const sourceIsCurrent = source => isCurrent() && source &&
      pageAvailable(source.tab) && !navigationStates.has(source.tab) &&
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
    const modelActions = modelGateway && createBrowserModelGateway({ gateway: modelGateway, getTarget, isCurrent: ownsQuestion, openConversation });
    const verifyPage = modelActions && (isSending => verifyReviewedBrowserSources(
      [{ tab: capture.tab, url: capture.page.url, documentRevision: capture.documentRevision }],
      async source => {
        const status = await control({ kind: "status" }).catch(() => undefined);
        const page = status?.tabs?.find(entry => entry.id === source.tab);
        return page?.documentRevision && !page.processFailed
          ? { tab: page.id, page: { url: page.url }, documentRevision: page.documentRevision }
          : null;
      },
      () => isSending() && !blocked() && ownsQuestion(),
    ));
    const sourcesCurrent = sources => sources.every(source => sourceIsCurrent(requestFor(source)));
    const reread = source => readSource(requestFor(source));
    const comparison = (onPrepareDraft || modelActions) && {
      peers,
      readSource,
      prepare: onPrepareDraft && ((sources, isPreparing) => prepareBrowserComparisonDraft({
        sources, getTarget, handoff: onPrepareDraft, openConversation,
        isCurrent: () => isPreparing() && ownsQuestion() && sourcesCurrent(sources),
        readSource: reread,
      })),
      verify: (sources, isSending) => verifyReviewedBrowserSources(sources, reread,
        () => isSending() && !blocked() && ownsQuestion() && sourcesCurrent(sources)),
    };
    const analysisArtifacts = createBrowserAnalysisArtifacts({ capture, getTarget,
      isCurrent: () => Boolean(captureElement?.isConnected), gateway: new ArtifactGateway() });
    const recognizeImage = async (image, frame, language) => {
      if (!isCurrent()) throw new Error(t("Page changed. Read it again."));
      const result = await invoke("browser_recognize_image_text", {
        tab: capture.tab, expectedUrl: capture.page.url, expectedRevision: capture.documentRevision, image, confirmed: true,
        ...(frame ? { frame } : {}),
        ...(language ? { language } : {}),
      });
      if (!isCurrent()) throw new Error(t("Page changed. Read it again."));
      return result;
    };
    const previewImage = async (image, frame) => {
      if (!isCurrent()) throw new Error(t("Page changed. Read it again."));
      const result = await invoke("browser_preview_image", {
        confirmed: true,
        target: {
          tab: capture.tab, expectedUrl: capture.page.url, expectedRevision: capture.documentRevision, image,
          ...(frame ? { frame } : {}),
        },
      });
      if (!isCurrent()) throw new Error(t("Page changed. Read it again."));
      return result;
    };
    const onDismiss = () => {
      captureDismissals++;
      void run(syncSurface);
    };
    captureElement = showBrowserCapture(capture, onDismiss, onPrepareDraft ? (attachments, isPreparing) => prepareBrowserDraft({
      capture, isCurrent: () => isPreparing() && ownsQuestion(), getTarget, handoff: onPrepareDraft, attachments, openConversation,
      readCurrent: () => invoke("browser_capture_page", { tab: tab.id, expectedUrl: capture.page.url }),
    }) : undefined, (isOpen, analysis) => createBrowserNoteWriter({ capture, getTarget, analysis,
      isCurrent: () => isOpen() && isCurrent(), gateway: new NotesGateway(),
      readCurrent: () => invoke("browser_capture_page", { tab: tab.id, expectedUrl: capture.page.url }),
    }), comparison, Boolean(openConversation), { host: assistant, trigger: read, modelActions, verifyPage, analysisArtifacts, recognizeImage, previewImage, questionDraft });
    await syncSurface();
  }
  async function navigate(submission, source) {
    if (active !== source || blocked()) return;
    const url = resolveBrowserAddress(submission.text, searchSettings.value());
    if (selected()?.localPdf) {
      await activation.add({ id: crypto.randomUUID(), url, title: url });
      addressEditor.accepted(submission);
      return;
    }
    if (!active) await add();
    await find.close();
    if (crashedTabs.has(active)) {
      await reopenCrashedTab(selected(), url);
      if (crashedTabs.has(active)) return;
    } else {
      if (!nativeTabs.has(active)) await ensureView({ ...selected(), url: "about:blank" });
      await control({ kind: "navigate", tab: active, url });
    }
    addressEditor.accepted(submission);
    selected().url = url; setStatus(""); paint(); await save();
  }
  function deactivateBrowserPanels() {
    visible = false;
    panelGeneration++;
    root?.querySelector(".browser-options[open]")?.removeAttribute("open");
    const reader = readerPanel;
    readerPanel = undefined;
    reader?.close();
    const panel = libraryPanel;
    libraryPanel = undefined;
    panel?.close();
    siteSettingsPanel?.panel.close();
    newTabShortcuts.select(null);
  }
  return {
    handlesLocaleChange: true,
    async finishWindowWrites() { await actionTail; await saveTail; await startupWrites; },
    async openSource(url, current) {
      await initPromise;
      if (!current()) return;
      if (!initialized) throw new Error(restoreError || t("This browser action is not available yet"));
      await openSavedPage({ url, title: new URL(url).host }, { current: () => !blocked() && current() });
    },
    renderContent(container) {
      if (!root) mount(); container.replaceChildren(root); visible = true;
      placeTabStrip();
      initPromise ??= restore();
      void initPromise.then(() => run(syncSurface));
    },
    async canDeactivate() {
      if (libraryPanel?.canCloseBookmarkDraft && !await libraryPanel.canCloseBookmarkDraft()) return false;
      assistant?.firstElementChild?.cancelBrowserModel?.();
      tabMenu?.close(); tabSearch?.close();
      await fullscreen?.leave(); await find?.close();
      ordering?.cancel(); deactivateBrowserPanels();
      await initPromise; await hide();
      return true;
    },
    deactivate() {
      assistant?.firstElementChild?.cancelBrowserModel?.();
      tabMenu?.close(); tabSearch?.close();
      void fullscreen?.leave(); void find?.close();
      ordering?.cancel(); deactivateBrowserPanels();
      void run(hide);
    },
  };
}
