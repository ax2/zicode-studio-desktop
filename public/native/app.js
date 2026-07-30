import { initializeI18n } from "../i18n.js";
import { reconcileSnapshotTarget } from "../session/bootstrap-target.js";
import { dispatchSuperAgentTaskNative } from "../super-agent/native-dispatch.js";
import { isSuperAgentProjectPath } from "../super-agent/session.js";
import { isSuperAgentEnabled } from "../super-agent/settings.js";
import { selectSuperAgentStartupAction } from "../super-agent/startup-flow.js";
import { buildTaskComposerPrompt, markTaskChildSessionBound } from "../super-agent/task-state.js";
import { updateSuperAgentTask } from "../super-agent/task-store.js";
import { applyTheme, getCurrentTheme } from "../themes.js";
import { ConvNav } from "../ui/conv-nav.js";
import { setupMessagesInsets } from "../ui/layout-insets.js";
import { MessageRenderer } from "../ui/message-renderer.js";
import { ToolCardRenderer } from "../ui/tool-card.js";
import { setupComposerImageAttachments } from "./composer/composer-images.js";
import { setupComposerSlashMenu } from "./composer/composer-slash-menu.js";
import { setupComposerSubmitHandling } from "./composer/composer-submit.js";
import { renderQueuedMessages } from "./composer/queued-messages.js";
import { buildCommandCatalog, resolveComposerInput } from "./composer/slash-commands.js";
import { setupCommandPalette } from "./extensions/command-palette.js";
import { showNativeDialog } from "./extensions/dialog.js";
import { ExtensionUiHost } from "./extensions/extension-ui-host.js";
import { showInlineExtensionPrompt } from "./extensions/inline-extension-prompt.js";
import { setupAppUpdater } from "./features/app-updater.js";
import { refreshLanQrButton, setupLanQr } from "./features/lan-qr.js";
import { resolveRemoteAuth } from "./features/remote-auth.js";
import {
  isRpivTodoCommandNotify,
  isRpivTodoWidgetRequest,
  RpivTodoMirrorPanel,
} from "./features/rpiv-todo-mirror.js";
import { createNotificationCenter } from "./notifications/notification-center.js";
import { createSessionSelectionHandler } from "./session/session-navigation.js";
import { setupSessionSearchDialog } from "./session/session-search-dialog.js";
import { SessionSidebar } from "./session/session-sidebar.js";
import { createSessionStore, reduceSessionState } from "./session/session-store.js";
import { setupSettingsPanel } from "./settings/settings-panel.js";
import { resolveBootstrapTarget } from "./transport/bootstrap-target.js";
import { ConfigGateway } from "./transport/config-gateway.js";
import {
  setupConfigGatewayConnectionListener,
  signalConfigGatewayReady,
} from "./transport/config-gateway-readiness.js";
import { HostControlGateway } from "./transport/control-gateway.js";
import { HostDataGateway } from "./transport/data-gateway.js";
import { HostRuntimeAdapter, resolveHostWebSocketUrl } from "./transport/runtime-adapter.js";
import { RuntimeGateway } from "./transport/runtime-gateway.js";
import { setupAppKeyboardShortcuts } from "./utils/keyboard-shortcuts.js";
import { randomId } from "./utils/random-id.js";
import { appRoutePath, parseAppRoute, replaceTemporarySessionRoute } from "./utils/router.js";
import { findLatestAssistantUsage, setupContextUsage } from "./workspace/context-usage.js";
import { NativeFileBrowser } from "./workspace/file-browser.js";
import { setupHeaderOpenApp } from "./workspace/header-open-app.js";
import { setupProjectHeader } from "./workspace/project-header.js";
import {
  createSessionViaHost,
  openSessionInProjectViaHost,
  resolveWorkspaceViaHost,
  setupNewSessionButton,
  setupOpenFolderButton,
  spawnSessionViaHost,
} from "./workspace/workspace-actions.js";

const route = parseAppRoute(window.location.pathname);
if (route.name !== "session") throw new Error("Native ZiCode Studio Desktop requires a session route");

initializeI18n();
applyTheme(getCurrentTheme());
document.body.dataset.runtime = "native";

const messagesElement = document.getElementById("messages");
const headerElement = document.querySelector(".header");
const scrollBottomBadge = document.getElementById("scroll-bottom-badge");
const convNav = new ConvNav({
  messagesEl: messagesElement,
  headerEl: headerElement,
  badgeEl: scrollBottomBadge,
});
const notifications = createNotificationCenter();

setupMessagesInsets({
  main: document.querySelector(".main"),
  messages: messagesElement,
  header: document.querySelector(".header"),
  inputArea: document.querySelector(".input-area"),
});
const messageRenderer = new MessageRenderer(messagesElement);
const toolRenderer = new ToolCardRenderer(messagesElement);
const input = document.getElementById("message-input");
const form = document.getElementById("chat-form");
const abortButton = document.getElementById("abort-btn");
const sendButton = document.getElementById("send-btn");
const statusText = document.getElementById("status-text");
const statusIndicator = document.getElementById("status-indicator");
const composerCard = document.getElementById("composer-card");
const commandButton = document.getElementById("command-btn");
const commandPalette = document.getElementById("command-palette");
const commandPaletteOverlay = document.getElementById("command-palette-overlay");
const commandList = document.getElementById("command-list");
const attachButton = document.getElementById("attach-btn");
const imageInput = document.getElementById("image-input");
const imagePreviews = document.getElementById("image-previews");
const skillSlashMenu = document.getElementById("skill-slash-menu");
const queuedMessages = document.getElementById("queued-messages");
const todoMirrorPanel = new RpivTodoMirrorPanel({
  container: document.querySelector(".input-area"),
});

// ── Composer model dropdown & thinking button ─────────────────────────────────
const modelDropdown = document.getElementById("model-dropdown");
const modelDropdownBtn = document.getElementById("model-dropdown-btn");
const modelDropdownLabel = document.getElementById("model-dropdown-label");
const modelDropdownMenu = document.getElementById("model-dropdown-menu");
const thinkingBtn = document.getElementById("thinking-btn");
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];
let currentThinkingLevel = "off";
let currentModelId = null;
let currentModelContextWindow = 0;
let availableModels = [];
let target = provisionalTargetFromRoute(route);
let configGatewayTargetReady = false;
let store = createSessionStore(target);
let navigationGeneration = 0;
let commandCatalog = buildCommandCatalog({});
let streamingElement = null;
let sidebar = null;
let activeSearchQuery = "";
// Auto-launch guard. Stored in sessionStorage (not a module variable) so it
// survives same-window `window.navigate()` reloads: when the user selects
// another project's session the inbox window reloads at the new URL, and
// without a durable guard auto-launch would immediately yank the window back
// to the Agent Inbox. sessionStorage is per-window/tab, so a genuinely new
// window still auto-launches once.
const SUPER_AGENT_LAUNCHED_KEY = "pi-studio-super-agent-launched";
function wasSuperAgentLaunched() {
  try {
    return sessionStorage.getItem(SUPER_AGENT_LAUNCHED_KEY) === "1";
  } catch {
    return false;
  }
}
function markSuperAgentLaunched() {
  try {
    sessionStorage.setItem(SUPER_AGENT_LAUNCHED_KEY, "1");
  } catch {
    // sessionStorage may be unavailable; auto-launch simply repeats.
  }
}
let pendingBoundSessionFirstMessage = null;
let superAgentEnsureInFlight = null;

// Maps a dispatched child runtime instanceId -> Agent Inbox task id, so
// `session_bound` events from the background child can upgrade the task's
// temporary child session id to the persisted one.
//
// Declared before the first `await` below: once `adapter.connect()` runs,
// background runtime events can arrive and call `bindDispatchedChildSession`
// (which reads this map) any time later top-level `await`s yield control
// back to the event loop — before the rest of this module's top-level code
// has finished executing. Declaring it late (as a later top-level `const`)
// caused a "Cannot access 'dispatchedInstances' before initialization" TDZ
// crash that could abort session creation on fresh installs.
const dispatchedInstances = new Map();

const remoteAuth = await resolveRemoteAuth();

const adapter = new HostRuntimeAdapter({
  url: resolveHostWebSocketUrl(window),
  clientId: `${remoteAuth.clientType}-${randomId()}`,
  clientType: remoteAuth.clientType,
  deviceToken: remoteAuth.deviceToken,
});
const runtime = new RuntimeGateway(adapter);
const data = new HostDataGateway(adapter, { fetchImpl: window.fetch.bind(window) });
const control = new HostControlGateway(adapter);
const config = new ConfigGateway({ runtime, getTarget: () => target });
window.__picotConfigCall = (op, params, options) => config.call(op, params, options);
const contextUsage = setupContextUsage();
const sessionCostEl = document.getElementById("session-cost");
let sessionTotalCost = 0;

function computeTotalCostFromMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    if (msg?.usage?.cost?.total) total += Number(msg.usage.cost.total) || 0;
  }
  return total;
}

function setSessionCost(cost) {
  sessionTotalCost = cost;
  if (!sessionCostEl) return;
  if (!cost || cost <= 0) {
    sessionCostEl.classList.remove("visible");
    sessionCostEl.textContent = "";
    return;
  }
  sessionCostEl.classList.add("visible");
  sessionCostEl.textContent = `$${cost.toFixed(4)}`;
  sessionCostEl.title = `Session cost: $${cost.toFixed(6)}`;
}
const extensionUi = new ExtensionUiHost({
  runtime,
  showDialog: (request, opts) => showNativeDialog(request, undefined, opts),
  showInlinePrompt: (request, opts) =>
    showInlineExtensionPrompt(request, { container: messagesElement, ...opts }),
  hooks: {
    notify: (request) => {
      // Configuration data-plane responses arrive as notify events; swallow
      // them so they don't render as chat messages.
      if (config.consumeNotify(request)) return;
      // rpiv-todo's /todos command emits a centered notify transcript. ZiCode Studio Desktop
      // already mirrors the same state natively, so expand the panel instead
      // of rendering a duplicate system message.
      if (isRpivTodoCommandNotify(request.message)) {
        todoMirrorPanel.expand();
        return;
      }
      messageRenderer.renderSystemMessage(request.message || "");
    },
    status: (request) => setStatus(request.statusText || "Connected"),
    title: (request) => {
      if (request.title) document.title = request.title;
    },
    editorText: (request) => {
      input.value = request.text || "";
      input.focus();
    },
    widget: (request) => {
      // rpiv-todo owns the tool/reducer; ZiCode Studio Desktop renders a native mirror from
      // the persisted todo tool-result snapshots instead of the TUI widget.
      if (isRpivTodoWidgetRequest(request)) return;
    },
  },
});
await extensionUi.setForegroundSession(target.sessionId, { flush: false });
await extensionUi.flushForegroundQueue();

const hydrateFromSnapshot = async (snapshot) => {
  await adoptTarget(reconcileSnapshotTarget(target, snapshot.target));
  store = reduceSessionState(store, snapshot);
  renderHistory(snapshot.state.messages ?? []);
  todoMirrorPanel.hydrateFromMessages(snapshot.state.messages ?? []);
  renderQueuedMessages(queuedMessages, store.queue);
  convNav.rebuild();
  const pi = snapshot.state.pi ?? {};
  setStatus(pi.isStreaming ? "Working…" : "Connected");
  updateComposerModel(pi.model ?? null);
  updateComposerThinking(pi.thinkingLevel ?? "off");
  contextUsage.setUsage(
    findLatestAssistantUsage(snapshot.state.messages),
    currentModelContextWindow,
  );
  setSessionCost(computeTotalCostFromMessages(snapshot.state.messages ?? []));
  // Flush queued extension prompts after rendering is settled so inline cards
  // are not immediately destroyed by a subsequent renderHistory() clear.
  await extensionUi.flushForegroundQueue();
};

runtime.subscribe((frame) => {
  if (frame.type !== "runtime_event") return;
  if (
    frame.target.instanceId !== target.instanceId ||
    (frame.target.sessionId && frame.target.sessionId !== target.sessionId)
  ) {
    handleBackgroundRuntimeEvent(frame).catch(showError);
    return;
  }
  const previous = store;
  store = reduceSessionState(store, frame);
  if (!previous.snapshotRequired && store.snapshotRequired) {
    hydrateSnapshot().catch(showError);
    return;
  }
  if (previous.queue !== store.queue) renderQueuedMessages(queuedMessages, store.queue);
  handleRuntimeEvent(frame.event).catch(showError);
});
setupConfigGatewayConnectionListener({
  adapter,
  isReady: () => configGatewayTargetReady,
  onDisconnected: () => setStatus("Disconnected"),
});
adapter.connect();

// Wire DOM-only event handlers immediately, before any network awaits, so the
// UI (settings overlay, file browser, composer, abort) stays responsive even
// when the runtime connection is slow, hangs, or fails. Previously these were
// attached after `await adapter.ready()/hydrateSnapshot()/loadCommands()`, so a
// stalled runtime left the settings button dead ("can't open settings").
setupSessionSidebar();
sidebar?.load().catch(showError);
setupSidebarToggle();
setupComposerSubmitHandling({
  input,
  form,
  onSubmit: ({ altKey }) => {
    sendComposerInput({ altKey }).catch(showError);
  },
});
abortButton?.addEventListener("click", abortCurrentRun);
messagesElement.addEventListener("messagefork", async (event) => {
  const { entryId } = event.detail;
  try {
    const result = await runtime.request({ type: "fork", entryId }, target, {
      idempotencyKey: randomId(),
    });
    const data = result?.response?.data;
    if (!data?.cancelled && data?.text != null) {
      input.value = data.text;
      input.focus();
    }
  } catch (error) {
    showError(error);
  }
});
document.getElementById("refresh-sessions-btn")?.addEventListener("click", (e) => {
  const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
  btn.classList.remove("spinning");
  // Force reflow so re-adding the class restarts the animation
  void btn.offsetWidth;
  btn.classList.add("spinning");
  ensureSuperAgentStartupSession({ reloadAfterEnsure: false }).catch(showError);
  sidebar?.load().catch(showError);
});
window.addEventListener("picot-super-agent-autostart-changed", (event) => {
  if (event.detail?.enabled) ensureSuperAgentStartupSession().catch(showError);
  else sidebar?.render();
});
setupFileBrowser();
const imageAttachments = setupComposerImageAttachments({
  input,
  attachButton,
  imageInput,
  previewContainer: imagePreviews,
  dropTarget: composerCard,
  onError: showError,
});
const slashMenu = setupComposerSlashMenu({
  input,
  container: skillSlashMenu,
  getCommands: () => commandCatalog.values(),
});
setupCommandPalette({
  button: commandButton,
  palette: commandPalette,
  overlay: commandPaletteOverlay,
  list: commandList,
  commands: () => [
    {
      icon: "🗜️",
      label: "Compact",
      desc: "Compact context to save tokens",
      action: () => runtime.request({ type: "compact" }, target, { idempotencyKey: randomId() }),
      disabled: store.lifecycle === "working",
    },
    {
      icon: "⬇️",
      label: "Expand All Tools",
      desc: "Expand all tool cards",
      action: () => toolRenderer.expandAll(),
    },
    {
      icon: "⬆️",
      label: "Collapse All Tools",
      desc: "Collapse all tool cards",
      action: () => toolRenderer.collapseAll(),
    },
    {
      icon: "⚙️",
      label: "Settings",
      desc: "Open ZiCode Studio Desktop settings",
      action: () => document.getElementById("settings-btn")?.click(),
    },
    {
      icon: "?",
      label: "Help",
      desc: "Show composer shortcuts",
      action: () => runBuiltin("show_help"),
    },
  ],
  onError: showError,
});
const settingsPanel = setupSettingsPanel({
  data,
  control,
  getWorkspaceId: () => target.workspaceId,
  configGateway: config,
  onModelConfigurationChanged: () => loadAvailableModels(),
  runtime,
  getTarget: () => target,
  onError: showError,
  notify: notifications.notify,
});
setupAppUpdater({ settingsPanel });
setupNewSessionButton({ data, workspaceId: target.workspaceId, onError: showError });
setupOpenFolderButton({ onError: showError });
setupLanQr({ control });
setupAppKeyboardShortcuts({
  input,
  abort: abortCurrentRun,
  isWorking: () => store.lifecycle === "working",
});
convNav.mount();

try {
  const bootstrappedTarget = await loadBootstrapTarget(route);
  await adoptTarget(bootstrappedTarget, { updateRoute: false });
  if (route.sessionId.startsWith("temporary-") && target.sessionId !== route.sessionId) {
    replaceTemporarySessionRoute(history, route.workspaceId, route.sessionId, target.sessionId);
  }
  await adapter.ready();

  // Two-phase load: render session history from disk immediately while Pi
  // warms up, then overlay the authoritative Pi snapshot when it arrives.
  // Skip the fast path for brand-new (temporary) sessions — they have no
  // saved JSONL file yet and go straight to the Pi snapshot. Focus the
  // composer so the user can start typing right away.
  if (!target.sessionId.startsWith("temporary-")) {
    const diskResult = await data
      .readSessionMessages(target.workspaceId, target.sessionId)
      .catch(() => null);
    const diskMessages = diskResult?.messages ?? [];
    if (diskMessages.length > 0) {
      renderHistory(diskMessages);
      convNav.rebuild();
      setStatus("Connected");
    }
  } else {
    input.focus();
  }

  await hydrateSnapshot();
  await Promise.all([
    loadCommands()
      .then(() => slashMenu.update())
      .catch((error) => {
        console.warn("[Native] Failed to load slash commands:", error);
      }),
    setupProjectHeader({ data, workspaceId: target.workspaceId }).catch((error) => {
      console.warn("[Native] Failed to load project header info:", error);
    }),
    Promise.resolve(
      setupHeaderOpenApp({ data, control, workspaceId: target.workspaceId, onError: showError }),
    ).catch((error) => {
      console.warn("[Native] Failed to set up app launcher:", error);
    }),
    refreshLanQrButton().catch((error) => {
      console.warn("[Native] Failed to refresh LAN QR button:", error);
    }),
    loadAvailableModels().catch((error) => {
      console.warn("[Native] Failed to load available models:", error);
    }),
  ]);
} catch (error) {
  showError(error);
}

function provisionalTargetFromRoute(currentRoute) {
  return {
    workspaceId: currentRoute.workspaceId,
    sessionId: currentRoute.sessionId,
    instanceId: "pending-bootstrap",
  };
}

async function loadBootstrapTarget(currentRoute) {
  return resolveBootstrapTarget({
    route: currentRoute,
    requestTarget: requestBootstrapTarget,
    spawnTemporarySession: spawnSessionViaHost,
  });
}

async function requestBootstrapTarget(currentRoute) {
  const query = new URLSearchParams({
    workspaceId: currentRoute.workspaceId,
    sessionId: currentRoute.sessionId,
  });
  const response = await fetch(`/v2/bootstrap?${query}`);
  if (!response.ok) {
    const error = new Error("This ZiCode Studio Desktop runtime is stopped or unavailable");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function hydrateSnapshot() {
  const expectedSessionId = target.sessionId;
  const snapshot = await runtime.snapshot(expectedSessionId);
  if (target.sessionId !== expectedSessionId) return; // stale: session switched while snapshot was in-flight
  await hydrateFromSnapshot(snapshot);
  configGatewayTargetReady = true;
  signalConfigGatewayReady();
}

async function loadCommands() {
  const result = await runtime.request({ type: "get_commands" }, target);
  commandCatalog = buildCommandCatalog({
    nativeCommands: result.response?.data?.commands ?? [],
  });
}

function setupSessionSidebar() {
  const container = document.getElementById("session-list");
  if (!container) return;
  const selectSession = createSessionSelectionHandler({
    switchSession,
    openSessionInProject,
    onError: showError,
  });
  sidebar = new SessionSidebar(container, {
    data,
    runtime,
    control,
    getTarget: () => target,
    onSelect: (session) => {
      updateSuperAgentActiveState(session);
      selectSession(session);
    },
    onCreateSession: createSessionViaHost,
    onSessionsLoaded: subscribeToLiveSessions,
  });

  setupSessionSearchDialog({
    triggerInput: document.getElementById("session-search-input"),
    triggerClear: document.getElementById("session-search-clear"),
    overlay: document.getElementById("session-search-overlay"),
    dialog: document.getElementById("session-search-dialog"),
    input: document.getElementById("session-search-dialog-input"),
    list: document.getElementById("session-search-results"),
    data,
    getWorkspaceId: () => target.workspaceId,
    getSessions: () => sidebar.sessions,
    onSelect: (session, { query } = {}) => {
      activeSearchQuery = query || "";
      updateSuperAgentActiveState(session);
      selectSession(session);
      if (session?.id === target.sessionId) applyActiveSearchHighlight();
    },
    onQueryChange: (query) => {
      activeSearchQuery = query || "";
      applyActiveSearchHighlight({ scrollToFirst: false });
    },
    onError: showError,
  });
}

async function switchSession(sessionId) {
  if (!sessionId || sessionId === target.sessionId) return;
  const generation = ++navigationGeneration;

  // Keep the current messages visible while the new session loads. The
  // history render below replaces them atomically once the new data is ready.
  setStatus("Loading\u2026");

  // Phase 1: fire bootstrap (spawns Pi if needed) and fast disk message read
  // in parallel. The disk read returns messages without waiting for Pi to start.
  const workspaceId = target.workspaceId;
  const [nextTarget, diskResult] = await Promise.all([
    loadBootstrapTarget({ name: "session", workspaceId, sessionId }),
    data.readSessionMessages(workspaceId, sessionId).catch(() => null),
  ]);
  if (generation !== navigationGeneration) return;

  await adoptTarget(nextTarget, { updateRoute: false });
  history.pushState(
    null,
    "",
    appRoutePath({ name: "session", workspaceId: target.workspaceId, sessionId: target.sessionId }),
  );
  // Authoritative re-check: whatever the caller passed to
  // updateSuperAgentActiveState() before invoking switchSession() may be
  // stale or skipped entirely (new sessions, sa-view-session routing, etc).
  // Recompute from the now-adopted target so a leftover `super-agent-active`
  // class can never survive a navigation and silently disable the header's
  // drag region (-webkit-app-region: drag) for the rest of the session.
  const adoptedSession =
    sidebar?.sessions?.find((session) => session.id === target.sessionId) ?? null;
  updateSuperAgentActiveState(adoptedSession);

  // Phase 2: render history from disk immediately — user sees messages right
  // away without waiting for the Pi process to warm up.
  const diskMessages = diskResult?.messages ?? [];
  renderHistory(diskMessages);
  convNav.rebuild();
  setStatus("Connected");

  // Phase 3: get the authoritative snapshot from Pi (Pi may still be starting).
  // When it arrives, re-render with the live state (model, thinking level,
  // lifecycle) and the authoritative message tree (handles branched sessions).
  try {
    const snapshot = await runtime.snapshot(target.sessionId);
    if (generation !== navigationGeneration) return;
    await hydrateFromSnapshot(snapshot);
  } catch (error) {
    if (generation !== navigationGeneration) return;
    // Pi snapshot failed but disk messages are already showing — degrade
    // gracefully rather than surfacing an error over a readable history.
    console.warn("[switchSession] Pi snapshot failed, showing disk history:", error);
    setStatus("Connected");
    // Still flush any queued extension prompts even when snapshot fails.
    await extensionUi.flushForegroundQueue();
  }
}

async function openSessionInProject(session) {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke) {
    // LAN/mobile: no Tauri window mechanism — resolve the target project's
    // workspace id over HTTP and navigate the current tab to its session
    // route so the page re-bootstraps against that workspace.
    await openSessionInProjectViaHost(session);
    return;
  }
  await invoke("open_session_in_project", {
    projectPath: session.projectPath,
    sessionId: session.id,
  });
}

function subscribeToLiveSessions(sessions) {
  for (const session of sessions ?? []) {
    const liveTarget = session?.target;
    if (liveTarget?.workspaceId && liveTarget?.sessionId && liveTarget?.instanceId) {
      adapter.subscribeTarget(liveTarget);
    }
  }
  updateSuperAgentActiveState((sessions ?? []).find((session) => session.id === target.sessionId));
  handleSuperAgentStartupSessions(sessions).catch(showError);
}

function updateSuperAgentActiveState(session = null) {
  const active = isSuperAgentSessionSummary(session);
  document.body.classList.toggle("super-agent-active", active);
  document.getElementById("super-agent-chat-header")?.classList.toggle("hidden", !active);
  if (active && localStorage.getItem("sa-runtime-collapsed") === "0") {
    document.querySelector("super-agent-runtime")?.classList.remove("collapsed");
  }
}

function isSuperAgentSessionSummary(session) {
  return session?.kind === "super-agent" || isSuperAgentProjectPath(session?.projectPath);
}

function insertTaskPrompt(task) {
  if (!task) return;
  const draft = input.value.trim();
  input.value = `${buildTaskComposerPrompt(task)}${draft ? `\n${draft}` : ""}`;
  input.focus();
}

document.addEventListener("sa-prompt-task", (event) => insertTaskPrompt(event.detail));
document.addEventListener("sa-view-session", (event) => {
  const task = event.detail;
  const childSessionId = task?.dispatch?.childSessionId;
  if (!childSessionId) return;
  // Dispatched tasks run inside their target project's own window/port, so a
  // plain in-window switchSession() can't reach them. Route to the owning
  // project's session (opens/focuses that project window) when we know the
  // target project; fall back to an in-window switch for same-project tasks.
  const projectPath = task?.dispatch?.targetProject || task?.targetProject;
  if (projectPath) {
    openSessionInProject({ id: childSessionId, projectPath }).catch(showError);
  } else {
    // Leaving the Agent Inbox session in-window: close its task panel so it
    // doesn't stay pinned over the session we're navigating to.
    updateSuperAgentActiveState(null);
    switchSession(childSessionId).catch(showError);
  }
});

document.addEventListener("sa-dispatch", (event) => {
  const task = event.detail;
  if (!task) return;
  dispatchSuperAgentTaskNative({
    task,
    resolveWorkspace: (projectPath) => resolveWorkspaceViaHost(projectPath),
    spawnSession: (workspaceId) => spawnSessionViaHost(workspaceId),
    sendPrompt: (dispatchTarget, message) =>
      runtime.request({ type: "prompt", message }, dispatchTarget, {
        idempotencyKey: randomId(),
      }),
    resolveBoundTarget: async (dispatchTarget) => {
      const snapshot = await runtime.snapshot(dispatchTarget.sessionId);
      return snapshot.target;
    },
    updateTask: (taskId, updater) =>
      updateSuperAgentTask(window.__picotConfigCall, taskId, updater),
    registerDispatchTarget: (dispatchTarget, taskId) => {
      dispatchedInstances.set(dispatchTarget.instanceId, taskId);
      adapter.subscribeTarget?.(dispatchTarget);
    },
  }).catch(showError);
});

async function handleSuperAgentStartupSessions(sessions) {
  const action = selectSuperAgentStartupAction({
    alreadyLaunched: wasSuperAgentLaunched(),
    enabled: isSuperAgentEnabled(),
    sessions,
    currentSessionId: target.sessionId,
  });
  if (action.type === "ensure") {
    await ensureSuperAgentStartupSession();
    return;
  }
  if (action.type === "launch") {
    await openSuperAgentSessionOnce(action.session);
  }
}

async function ensureSuperAgentStartupSession({ reloadAfterEnsure = true } = {}) {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke || !isSuperAgentEnabled()) return;
  if (!superAgentEnsureInFlight) {
    superAgentEnsureInFlight = invoke("ensure_agent_inbox_session").finally(() => {
      superAgentEnsureInFlight = null;
    });
  }
  await superAgentEnsureInFlight;
  if (reloadAfterEnsure) await sidebar?.load({ quiet: true });
}

async function openSuperAgentSessionOnce(session) {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (!invoke || !session) return;
  markSuperAgentLaunched();
  try {
    await invoke("open_session_in_project", {
      projectPath: session.projectPath,
      sessionId: session.id,
    });
  } catch (error) {
    console.warn("[SuperAgent] Failed to auto-launch Agent Inbox:", error);
  }
}

async function handleBackgroundRuntimeEvent(frame) {
  const sessionId = frame.target?.sessionId;
  switch (frame.event?.type) {
    case "agent_start":
      sidebar?.setStreaming(sessionId, true);
      sidebar?.markUnread(sessionId);
      break;
    case "agent_settled":
    case "agent_end":
      sidebar?.setStreaming(sessionId, false);
      sidebar?.markUnread(sessionId);
      break;
    case "message_end":
      if (frame.event.message?.role === "assistant") sidebar?.markUnread(sessionId);
      break;
    case "session_bound":
      await bindDispatchedChildSession(frame.target?.instanceId, frame.event?.sessionId);
      break;
  }
}

// When a dispatched child runtime binds its persisted session id, upgrade the
// owning Agent Inbox task so "View Session ->" navigates to the real session.
async function bindDispatchedChildSession(instanceId, boundSessionId) {
  if (!instanceId || !boundSessionId) return;
  const taskId = dispatchedInstances.get(instanceId);
  if (!taskId) return;
  dispatchedInstances.delete(instanceId);
  await updateSuperAgentTask(window.__picotConfigCall, taskId, (task) =>
    markTaskChildSessionBound(task, { childSessionId: boundSessionId }),
  ).catch((error) => console.warn("[SuperAgent] failed to bind child session:", error));
}

function setupSidebarToggle() {
  const sidebarEl = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("sidebar-toggle");
  const overlay = document.getElementById("sidebar-overlay");
  if (!sidebarEl || !toggleBtn) return;

  const isMobile = () => window.innerWidth <= 768;

  const setCollapsed = (collapsed) => {
    sidebarEl.classList.toggle("collapsed", collapsed);
    overlay?.classList.toggle("visible", !collapsed && isMobile());
  };

  // Auto-collapse on mobile so sidebar doesn't block content on first load
  if (isMobile()) {
    setCollapsed(true);
  }

  toggleBtn.addEventListener("click", () => {
    setCollapsed(!sidebarEl.classList.contains("collapsed"));
  });
  overlay?.addEventListener("click", () => setCollapsed(true));
  overlay?.addEventListener("touchend", (e) => {
    e.preventDefault();
    setCollapsed(true);
  });
}

function setupFileBrowser() {
  const sidebar = document.getElementById("file-sidebar");
  const fileList = document.getElementById("file-list");
  const pathEl = document.getElementById("file-sidebar-path");
  if (!sidebar || !fileList || !pathEl) return;

  const upBtn = document.getElementById("file-sidebar-up");
  if (upBtn) upBtn.disabled = true; // disabled until we've navigated into a subdir

  const browser = new NativeFileBrowser(fileList, pathEl, data, target.workspaceId, {
    onPathChange(path) {
      // Enable the up button only when we're inside a subdirectory.
      if (upBtn) upBtn.disabled = path === "";
    },
  });

  document.getElementById("file-sidebar-finder")?.addEventListener("click", async () => {
    try {
      const info = await data.workspaceInfo(target.workspaceId);
      const root = info?.path ?? "";
      const current = browser.currentPath ?? "";
      const absolutePath = current ? `${root}/${current}` : root;
      await control.openInApp(absolutePath);
    } catch (error) {
      showError(error);
    }
  });

  document.getElementById("file-sidebar-toggle")?.addEventListener("click", () => {
    const isCollapsed = sidebar.classList.toggle("collapsed");
    if (!isCollapsed && browser.currentPath === null) browser.load().catch(showError);
  });
  document.getElementById("file-sidebar-close")?.addEventListener("click", () => {
    sidebar.classList.add("collapsed");
  });
  upBtn?.addEventListener("click", () => {
    const parent = browser.getParentPath();
    if (parent !== null) browser.load(parent).catch(showError);
  });
}

async function sendComposerInput({ altKey }) {
  const value = input.value;
  const images = imageAttachments.getImages();
  if (!value.trim() && images.length === 0) return;
  const intent = resolveComposerInput(value, commandCatalog, {
    working: store.lifecycle === "working",
    altKey,
    images,
  });
  if (intent.kind === "rejected") throw new Error(intent.reason);
  if (intent.kind === "builtin") {
    runBuiltin(intent.action);
    return;
  }
  input.value = "";
  input.scrollTop = 0;
  imageAttachments.clear();
  try {
    await runtime.request(intent.command, target, { idempotencyKey: randomId() });
  } catch (error) {
    input.value = value;
    imageAttachments.setImages(images);
    throw error;
  }
}

function runBuiltin(action) {
  if (action === "open_settings") document.getElementById("settings-btn")?.click();
  else if (action === "open_tree") document.dispatchEvent(new CustomEvent("picot:open-tree"));
  else if (action === "show_help") {
    messageRenderer.renderSystemMessage(
      "Enter sends a prompt; while working Enter steers and Alt+Enter queues a follow-up. Use // for a literal slash.",
    );
  }
}

async function handleRuntimeEvent(event) {
  switch (event.type) {
    case "agent_start":
      setStatus("Working…");
      sidebar?.setStreaming(target.sessionId, true);
      break;
    case "agent_settled":
      setStatus("Connected");
      sidebar?.setStreaming(target.sessionId, false);
      break;
    case "message_start":
      if (event.message?.role === "user") {
        messageRenderer.renderUserMessage(event.message);
        upsertActiveSessionFromUserMessage(event.message);
      } else if (event.message?.role === "assistant") {
        streamingElement = messageRenderer.renderAssistantMessage(event.message, true);
      }
      break;
    case "message_update":
      if (!streamingElement) {
        streamingElement = messageRenderer.renderAssistantMessage(event.message, true);
      } else {
        messageRenderer.updateStreamingMessage(streamingElement, event.message?.content ?? []);
      }
      break;
    case "message_end":
      if (event.message?.role === "assistant" && streamingElement) {
        messageRenderer.updateStreamingMessage(streamingElement, event.message.content ?? []);
        messageRenderer.finalizeStreamingMessage(streamingElement, event.message.usage ?? null);
        contextUsage.setUsage(event.message.usage ?? null, currentModelContextWindow);
        setSessionCost(sessionTotalCost + (event.message.usage?.cost?.total ?? 0));
        streamingElement = null;
        convNav.notifyNewMessage();
      }
      break;
    case "tool_execution_start":
      toolRenderer.createToolCard({ ...event, status: "pending" });
      break;
    case "tool_execution_update":
      toolRenderer.updateToolCard({
        ...event,
        status: "streaming",
        output: textFromResult(event.partialResult),
      });
      break;
    case "tool_execution_end":
      toolRenderer.finalizeToolCard(event.toolCallId, event.result, event.isError);
      if (event.toolName === "todo" && !event.isError)
        todoMirrorPanel.applyToolResult(event.result);
      break;
    case "extension_ui_request":
      await extensionUi.handle(target, event);
      break;
    case "extension_error":
      showError(new Error(event.error || "Extension failed"));
      break;
    case "session_bound":
      await adoptTarget({ ...target, sessionId: event.sessionId });
      upsertActiveSessionFromUserMessage();
      await hydrateSnapshot();
      sidebar?.load({ quiet: true }).catch(showError);
      break;
  }
}

function upsertActiveSessionFromUserMessage(message = null) {
  const firstMessage = message
    ? textFromMessageContent(message.content)
    : pendingBoundSessionFirstMessage;
  if (target?.sessionId?.startsWith("temporary-")) {
    pendingBoundSessionFirstMessage = firstMessage;
    return;
  }
  if (!target?.sessionId) return;
  sidebar?.upsertSession({
    id: target.sessionId,
    firstMessage,
    timestamp: new Date().toISOString(),
    modifiedAtMs: Date.now(),
    isCurrentWorkspace: true,
  });
  pendingBoundSessionFirstMessage = null;
}

async function adoptTarget(nextTarget, { updateRoute = true } = {}) {
  const previousTarget = target;
  const sessionChanged = nextTarget.sessionId !== previousTarget.sessionId;
  const targetChanged =
    sessionChanged ||
    nextTarget.workspaceId !== previousTarget.workspaceId ||
    nextTarget.instanceId !== previousTarget.instanceId;
  if (!targetChanged) return;
  configGatewayTargetReady = false;
  if (updateRoute && sessionChanged) {
    replaceTemporarySessionRoute(
      history,
      previousTarget.workspaceId,
      previousTarget.sessionId,
      nextTarget.sessionId,
    );
  }
  target = nextTarget;
  store = createSessionStore(target);
  renderQueuedMessages(queuedMessages, store.queue);
  todoMirrorPanel.clear();
  streamingElement = null;
  adapter.subscribeTarget(target);
  sidebar?.setActive(target.sessionId);
  await extensionUi.setForegroundSession(target.sessionId, { flush: false });
}

function renderHistory(messages) {
  messageRenderer.clear();
  toolRenderer.clear();
  if (messages.length === 0) {
    messageRenderer.renderWelcome();
    applyActiveSearchHighlight({ scrollToFirst: false });
    return;
  }

  // Pre-index tool results by toolCallId for O(1) lookup
  const toolResults = new Map();
  for (const message of messages) {
    if (message.role === "toolResult") {
      toolResults.set(message.toolCallId, message);
    }
  }

  for (const message of messages) {
    if (message.role === "user") messageRenderer.renderUserMessage(message, true);
    if (message.role === "assistant") {
      messageRenderer.renderAssistantMessage(message, false, true);
      // Render tool-call cards embedded in this assistant message
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "toolCall") {
            toolRenderer.createHistoryCard({
              toolCallId: block.id,
              toolName: block.name,
              args: block.arguments ?? {},
            });
            const result = toolResults.get(block.id);
            if (result) {
              toolRenderer.addHistoryResult(block.id, result, result.isError);
            }
          }
        }
      }
    }
  }
  const highlighted = applyActiveSearchHighlight();
  if (highlighted === 0) messageRenderer.forceScrollToBottom();
}

function applyActiveSearchHighlight({ scrollToFirst = true } = {}) {
  const query = activeSearchQuery.trim();
  if (!query) {
    messageRenderer.clearSearchHighlights();
    return 0;
  }
  return messageRenderer.highlightSearchQuery(query, { scrollToFirst });
}

function textFromResult(result) {
  return (result?.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function textFromMessageContent(content) {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((block) => block?.type === "text")
            .map((block) => block.text ?? "")
            .join("\n")
        : "";
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function setStatus(text) {
  statusText.textContent = text;
  const isWorking = text === "Working…";
  // Keep Stop visible while an extension question is open/queued for this
  // session even if a stale status frame briefly reports "Connected" (e.g.
  // right after a session switch) — otherwise the only way to unblock a
  // wedged tool call becomes unreachable.
  const showAbort = isWorking || extensionUi.hasPending(target.sessionId);
  statusIndicator?.classList.toggle("streaming", isWorking);
  composerCard?.classList.toggle("streaming", isWorking);
  abortButton?.classList.toggle("hidden", !showAbort);
  sendButton?.classList.toggle("hidden", showAbort);
  statusIndicator?.classList.toggle("disconnected", text === "Disconnected");
  statusIndicator?.classList.toggle("connected", !isWorking && text !== "Disconnected");
}

function abortCurrentRun() {
  runtime.request({ type: "abort" }, target).catch(showError);
  // A tool call blocked on ctx.ui.select/confirm/input/editor won't be
  // unblocked by "abort" alone — pi is waiting on an extension_ui_response
  // that only the UI can send. Without this, an unanswered/cancelled prompt
  // leaves the run wedged forever with Stop appearing to do nothing.
  extensionUi.cancelForeground();
}

function showError(error) {
  setStatus("Disconnected");
  messageRenderer.renderError(error?.message || String(error));
}

// ── Composer model dropdown & thinking button (functions & event wiring) ────────

function updateComposerModel(model) {
  currentModelId = model?.id ?? null;
  currentModelContextWindow =
    Number(model?.contextWindow) || findModelContextWindow(currentModelId);
  contextUsage.setContextWindowSize(currentModelContextWindow);
  if (modelDropdownLabel) {
    modelDropdownLabel.textContent = formatModelName(model) || "model";
  }
}

function updateComposerThinking(level) {
  currentThinkingLevel = level ?? "off";
  if (thinkingBtn) {
    thinkingBtn.textContent = `Think ${currentThinkingLevel}`;
    thinkingBtn.className = `thinking-tag${currentThinkingLevel === "off" ? " off" : ""}`;
    thinkingBtn.setAttribute(
      "aria-label",
      `Thinking effort: ${currentThinkingLevel}. Click to cycle reasoning depth.`,
    );
  }
  // Sync settings panel radio group
  settingsPanel?.thinkingControl?.updateUI(level);
}

async function loadAvailableModels() {
  try {
    const result = await runtime.request({ type: "get_available_models" }, target);
    const runtimeModels = result?.response?.data?.models ?? [];
    availableModels = await applyConfiguredModelVisibility(runtimeModels);
    if (!currentModelContextWindow) {
      currentModelContextWindow = findModelContextWindow(currentModelId);
      contextUsage.setContextWindowSize(currentModelContextWindow);
    }
    renderModelDropdownMenu();
  } catch (error) {
    console.warn("[Native] Failed to load available models:", error);
  }
}

async function applyConfiguredModelVisibility(models) {
  try {
    const catalog = await config.call("list_model_catalog");
    if (!catalog?.ok) throw new Error(catalog?.error || "Failed to load model catalog");
    const visibleKeys = new Set();
    for (const provider of catalog.data?.providers ?? []) {
      for (const model of provider.models ?? []) {
        if (model.available && model.visible !== false) {
          visibleKeys.add(`${model.provider || provider.provider}/${model.id}`);
        }
      }
    }
    return models.filter((model) => visibleKeys.has(`${model.provider}/${model.id}`));
  } catch (error) {
    console.warn("[Native] Failed to load configured model visibility:", error);
    return models;
  }
}

function findModelContextWindow(modelId) {
  if (!modelId) return 0;
  const model = availableModels.find((candidate) => candidate.id === modelId);
  return Number(model?.contextWindow) || 0;
}

function formatModelName(model) {
  const raw = typeof model === "string" ? model : model?.name || model?.id || "";
  return raw.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function getModelSearchText(model) {
  return [model.name, model.id, model.provider].filter(Boolean).join(" ").toLowerCase();
}

function renderEmptyModelDropdown(container) {
  const empty = document.createElement("div");
  empty.className = "model-dropdown-empty";

  const title = document.createElement("div");
  title.className = "model-dropdown-empty-title";
  title.textContent = "No models available";

  const message = document.createElement("div");
  message.textContent = "No API keys configured. Set a key in Settings → Configuration.";

  const settingsButton = document.createElement("button");
  settingsButton.type = "button";
  settingsButton.className = "btn-primary model-dropdown-empty-action";
  settingsButton.textContent = "Open Settings";
  settingsButton.addEventListener("click", () => {
    closeModelDropdown();
    settingsPanel?.openSettings("configuration");
  });

  empty.append(title, message, settingsButton);
  container.appendChild(empty);
}

function buildModelDropdownItem(model) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = `model-dropdown-item${model.id === currentModelId ? " active" : ""}`;

  const nameWrap = document.createElement("span");
  nameWrap.className = "model-dropdown-item-name";
  nameWrap.textContent = formatModelName(model);

  if (model.provider && model.provider !== "anthropic") {
    const provider = document.createElement("span");
    provider.className = "model-dropdown-item-provider";
    provider.textContent = model.provider;
    nameWrap.appendChild(provider);
  }

  const context = document.createElement("span");
  context.className = "model-dropdown-item-ctx";
  context.textContent = model.contextWindow
    ? `${(Number(model.contextWindow) / 1000).toFixed(0)}k`
    : "";

  item.append(nameWrap, context);
  item.addEventListener("click", async () => {
    closeModelDropdown();
    try {
      await runtime.request(
        { type: "set_model", provider: model.provider, modelId: model.id },
        target,
        { idempotencyKey: randomId() },
      );
      updateComposerModel(model);
    } catch (error) {
      showError(error);
    }
  });

  return item;
}

function renderModelDropdownItems(container, filter = "") {
  container.innerHTML = "";
  if (availableModels.length === 0) {
    renderEmptyModelDropdown(container);
    return;
  }

  const query = filter.trim().toLowerCase();
  const matchingModels = query
    ? availableModels.filter((model) => getModelSearchText(model).includes(query))
    : availableModels;

  if (matchingModels.length === 0) {
    const empty = document.createElement("div");
    empty.className = "model-dropdown-empty";
    empty.textContent = "No models match your search.";
    container.appendChild(empty);
    return;
  }

  for (const model of matchingModels) {
    container.appendChild(buildModelDropdownItem(model));
  }
}

function renderModelDropdownMenu() {
  if (!modelDropdownMenu) return;
  modelDropdownMenu.innerHTML = "";

  const search = document.createElement("input");
  search.className = "model-dropdown-search";
  search.placeholder = "Search models…";
  search.type = "text";
  modelDropdownMenu.appendChild(search);

  const itemsContainer = document.createElement("div");
  itemsContainer.className = "model-dropdown-items";
  modelDropdownMenu.appendChild(itemsContainer);

  renderModelDropdownItems(itemsContainer);

  search.addEventListener("input", () => renderModelDropdownItems(itemsContainer, search.value));
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModelDropdown();
      event.stopPropagation();
    }
    if (event.key === "Enter") {
      itemsContainer.querySelector(".model-dropdown-item")?.click();
    }
  });
}

function openModelDropdown() {
  if (!modelDropdownMenu) return;
  renderModelDropdownMenu();
  modelDropdownMenu.classList.remove("hidden");
  modelDropdown?.classList.add("open");
  modelDropdownBtn?.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => modelDropdownMenu.querySelector(".model-dropdown-search")?.focus());
}

function closeModelDropdown() {
  modelDropdownMenu?.classList.add("hidden");
  modelDropdown?.classList.remove("open");
  modelDropdownBtn?.setAttribute("aria-expanded", "false");
}

if (modelDropdownBtn) {
  modelDropdownBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = !modelDropdownMenu?.classList.contains("hidden");
    if (isOpen) {
      closeModelDropdown();
    } else {
      if (availableModels.length === 0) loadAvailableModels();
      openModelDropdown();
    }
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("#model-dropdown")) closeModelDropdown();
});

if (thinkingBtn) {
  thinkingBtn.addEventListener("click", async () => {
    const idx = THINKING_LEVELS.indexOf(currentThinkingLevel);
    const nextLevel = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
    try {
      await runtime.request({ type: "set_thinking_level", level: nextLevel }, target, {
        idempotencyKey: randomId(),
      });
      updateComposerThinking(nextLevel);
    } catch (error) {
      showError(error);
    }
  });
}

window.__picotNative = {
  runtime,
  data,
  adapter,
  get target() {
    return target;
  },
};
