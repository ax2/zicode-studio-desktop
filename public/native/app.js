import { initializeI18n, t } from "../i18n.js";
import { reconcileSnapshotTarget } from "../session/bootstrap-target.js";
import { dispatchSuperAgentTaskNative } from "../super-agent/native-dispatch.js";
import { isSuperAgentProjectPath } from "../super-agent/session.js";
import { isSuperAgentEnabled } from "../super-agent/settings.js";
import { selectSuperAgentStartupAction } from "../super-agent/startup-flow.js";
import {
  buildTaskComposerPrompt,
  markTaskChildSessionBound,
  markTaskFinished,
} from "../super-agent/task-state.js";
import { updateSuperAgentTask } from "../super-agent/task-store.js";
import { applyTheme, getCurrentTheme } from "../themes.js";
import { ConvNav } from "./react/conv-nav.js";
import { setupMessagesInsets } from "../ui/layout-insets.js";
import { MessageRenderer, ToolCardRenderer } from "./react/chat.js";
import { MOBILE_SHELL_QUERY, setupSidebarToggle } from "../ui/sidebar-toggle.js";
import { setupComposerImageAttachments } from "./react/composer.js";
import { setupComposerSlashMenu } from "./react/composer.js";
import { buildCommandCatalog, resolveComposerInput } from "./composer/slash-commands.js";
import { setupCommandPalette } from "./react/command-palette.js";
import { showNativeDialog } from "./react/dialog.js";
import { ExtensionUiHost } from "./extensions/extension-ui-host.js";
import { showInlineExtensionPrompt } from "./react/inline-extension-prompt.js";
import { setupFinanceWorkbench } from "./react/finance-workbench.js";
import { setupHelpCenter } from "./react/help.js";
import { refreshLanQrButton, setupLanQr } from "./react/lan-qr.js";
import { setupMobileDraftRecovery } from "./features/mobile-draft-recovery.js";
import { setupMobileExperience } from "./react/mobile-experience.js";
import { setupMobileSendLater } from "./react/mobile-send-later.js";
import { consumeMobileShareTarget } from "./features/mobile-share-target.js";
import {
  createAuthenticatedHostFetch,
  remoteE2eePublicKey,
  resolveRemoteAuth,
} from "./features/remote-auth.js";
import {
  isRpivTodoCommandNotify,
  isRpivTodoWidgetRequest,
  RpivTodoMirrorPanel,
} from "./react/rpiv-todo-mirror.js";
import { setupSceneIndicator } from "./react/scene-indicator.js";
import { renderStartupFailure } from "./react/startup-failure.js";
import {
  estimateRequestCost,
} from "./models/model-routing.js";
import { createNotificationCenter } from "./react/notification-center.js";
import { setupArtifactApp } from "./react/artifacts.js";
import { ArtifactGateway } from "./plugins/artifact-gateway.js";
import { setupAutomationApp } from "./react/automation.js";
import { setupNotesApp } from "./react/notes.js";
import { createModelDropdownFeed } from "./react/composer.js";
import { setupComposer } from "./react/composer.js";
import { NotesGateway } from "./plugins/notes-gateway.js";
import { PluginCapabilityGateway } from "./plugins/plugin-capability-gateway.js";
import { PluginHostGateway } from "./plugins/plugin-host-gateway.js";
import { createBuiltinPluginRegistry } from "./plugins/plugin-registry.js";
import { PLUGIN_HISTORY_STATE_KEY, setupPluginShell } from "./plugins/plugin-shell.js";
import { setupPluginViewHost } from "./plugins/plugin-view-host.js";
import {
  readProjectWorkspaceProfile,
  setupProjectWorkspaceApp,
} from "./react/projects.js";
import { setupTaskCenterApp } from "./react/tasks.js";
import {
  createHistoryWindow,
} from "./react/history-window.js";
import { createSessionSelectionHandler } from "./session/session-navigation.js";
import { setupSessionSearchDialog } from "./react/session-search-dialog.js";
import { SessionSidebar } from "./react/session-sidebar.js";
import { createSessionStore, reduceSessionState } from "./session/session-store.js";
import { setupAppUpdater, setupSettingsPanel } from "./react/settings.js";
import { resolveBootstrapTarget } from "./transport/bootstrap-target.js";
import { ConfigGateway } from "./transport/config-gateway.js";
import {
  setupConfigGatewayConnectionListener,
  signalConfigGatewayReady,
} from "./transport/config-gateway-readiness.js";
import { HostControlGateway } from "./transport/control-gateway.js";
import { HostDataGateway } from "./transport/data-gateway.js";
import { RemoteAccessGateway } from "./transport/remote-access-gateway.js";
import { HostRuntimeAdapter, resolveHostWebSocketUrl } from "./transport/runtime-adapter.js";
import { RuntimeGateway } from "./transport/runtime-gateway.js";
import { setupAppKeyboardShortcuts } from "./utils/keyboard-shortcuts.js";
import { randomId } from "./utils/random-id.js";
import {
  appRoutePath,
  parseAppRoute,
  replaceTemporarySessionRoute,
  resolveHistoryNavigation,
} from "./utils/router.js";
import { findLatestAssistantUsage, setupContextUsage } from "./react/context-usage.js";
import { NativeFileBrowser } from "./react/file-browser.js";
import { setupProjectHeader } from "./react/project-header.js";
import {
  createSessionViaHost,
  openSessionInProjectViaHost,
  resolveWorkspaceViaHost,
  setupNewSessionButton,
  setupOpenFolderButton,
  spawnSessionViaHost,
} from "./workspace/workspace-actions.js";

const route = parseAppRoute(window.location.pathname);
if (route.name !== "session")
  throw new Error("Native ZiCode Studio Desktop requires a session route");

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

function showSceneSettings() {
  settingsPanel?.openSettings("general");
  requestAnimationFrame(() => {
    document
      .getElementById("scene-profile-section")
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

const messageRenderer = new MessageRenderer(messagesElement, {
  onOpenSceneSettings: showSceneSettings,
  onRevealHistory: revealEarlierHistory,
  openApp: (pluginId) => pluginShell?.activate(pluginId),
});
const toolRenderer = new ToolCardRenderer(messagesElement);
const composer = setupComposer({
  onSubmit: ({ altKey }) => {
    sendComposerInput({ altKey }).catch(showError);
  },
});
const {
  input,
  abortButton,
  sendButton,
  composerCard,
  commandButton,
  attachButton,
  imageInput,
  imagePreviews,
  skillSlashMenu,
  modelDropdown,
  modelDropdownBtn,
  modelDropdownLabel,
  modelDropdownMenu,
  thinkingBtn,
} = composer ?? {};
const statusText = document.getElementById("status-text");
const statusIndicator = document.getElementById("status-indicator");
const commandPalette = document.getElementById("command-palette");
const commandPaletteOverlay = document.getElementById("command-palette-overlay");
const commandList = document.getElementById("command-list");
const todoMirrorPanel = new RpivTodoMirrorPanel({
  container: document.querySelector(".input-area"),
});

// ── Composer model dropdown & thinking button ─────────────────────────────────
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];
let currentThinkingLevel = "off";
let currentModelId = null;
let currentModelContextWindow = 0;
let availableModels = [];
let modelsLoading = false;
let modelLoadError = "";
let modelLoadPromise = null;
const modelDropdownFeed = createModelDropdownFeed(
  /** @type {HTMLElement} */ (modelDropdownMenu),
  () => ({
    models: availableModels,
    loading: modelsLoading,
    error: modelLoadError,
    currentModelId,
    currentContextWindow: currentModelContextWindow,
  }),
  {
    onSelect: async (model) => {
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
    },
    onOpenSettings: () => {
      closeModelDropdown();
      settingsPanel?.openSettings("configuration");
    },
    onRetry: () => {
      loadAvailableModels();
    },
    onClose: () => {
      closeModelDropdown();
    },
  },
);
let target = provisionalTargetFromRoute(route);
let currentProjectInfo = null;
let configGatewayTargetReady = false;
let store = createSessionStore(target);
let navigationGeneration = 0;
let commandCatalog = buildCommandCatalog({});
let streamingElement = null;
let pendingOrganizeNote = null;
let sidebar = null;
let pluginShell = null;
let activeSearchQuery = "";
let lastRetryableRequest = null;
let mobileDrafts = null;
let mobileSendLater = null;
let imageAttachments = null;
let historyWindow = null;
let historyWindowTargetKey = "";
let currentHistoryMessages = [];
let historyRevealCompleted = false;
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
const hostFetch = createAuthenticatedHostFetch({
  deviceToken: remoteAuth.deviceToken,
  location: window.location,
  fetchImpl: window.fetch.bind(window),
});

let iceServers = [];
try {
  const configResponse = await hostFetch("/v2/remote-config");
  if (configResponse.ok) {
    const remoteConfig = await configResponse.json();
    if (Array.isArray(remoteConfig.iceServers)) iceServers = remoteConfig.iceServers;
  }
} catch {
  // Without STUN/TURN the P2P transport still works for host candidates
  // (same LAN); otherwise it falls back to the WebSocket data path.
}

const adapter = new HostRuntimeAdapter({
  url: resolveHostWebSocketUrl(window),
  clientId: `${remoteAuth.clientType}-${randomId()}`,
  clientType: remoteAuth.clientType,
  deviceToken: remoteAuth.deviceToken,
  e2eePublicKey: remoteAuth.clientType === "remote" ? remoteE2eePublicKey() : undefined,
  p2pEnabled: remoteAuth.clientType === "remote",
  iceServers,
});
const mobileExperience = setupMobileExperience({ adapter, clientType: remoteAuth.clientType });
adapter.setFatalErrorListener((error) => renderStartupFailure(error));
adapter.setConnectionListener((connected) => {
  // After the host restarts, the bound runtime instance is gone. Re-resolve
  // the session's live instance as soon as the connection comes back so the
  // client never sends into a dead runtime — no manual refresh needed.
  if (!connected || !target?.sessionId || target.sessionId.startsWith("temporary-")) return;
  void loadBootstrapTarget({
    name: "session",
    workspaceId: target.workspaceId,
    sessionId: target.sessionId,
  })
    .then((nextTarget) => {
      if (nextTarget.instanceId !== target.instanceId) {
        target = { ...target, instanceId: nextTarget.instanceId };
      }
    })
    .catch(() => {});
});
const runtime = new RuntimeGateway(adapter);
const data = new HostDataGateway(adapter, { fetchImpl: hostFetch });
const control = new HostControlGateway(adapter);
const remoteAccessGateway = new RemoteAccessGateway(adapter);
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
      mobileDrafts?.sync();
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
  mobileExperience?.setTaskRunning(target, store.lifecycle === "working");
  renderHistory(snapshot.state.messages ?? []);
  todoMirrorPanel.hydrateFromMessages(snapshot.state.messages ?? []);
  composer?.setQueue(store.queue);
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
  mobileExperience?.handleRuntimeEvent(frame.event, frame.target, frame.sequence);
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
  if (previous.queue !== store.queue) composer?.setQueue(store.queue);
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
      mobileDrafts?.sync();
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
imageAttachments = setupComposerImageAttachments({
  input,
  attachButton,
  imageInput,
  previewContainer: imagePreviews,
  dropTarget: composerCard,
  onError: showError,
  onBusyChange: (busy) => {
    if (!sendButton) return;
    sendButton.disabled = busy;
    sendButton.setAttribute("aria-busy", String(busy));
  },
  onChange: () => mobileDrafts?.syncImages(),
});
mobileDrafts = setupMobileDraftRecovery({
  clientType: remoteAuth.clientType,
  getImages: () => imageAttachments.getImages(),
  getTarget: () => target,
  input,
  setImages: (images) => imageAttachments.setImages(images),
  onImagesOmitted: () => {
    notifications.notify({
      message: t("Some unsent images are too large to save for recovery."),
      title: t("Some images will need to be selected again"),
      type: "warning",
    });
  },
  onRestored: () => {
    notifications.notify({
      type: "success",
      title: t("Unsent draft restored on this device"),
    });
  },
});
mobileSendLater = setupMobileSendLater({
  adapter,
  clientType: remoteAuth.clientType,
  composerRoot: composerCard,
  drafts: mobileDrafts,
  getTarget: () => target,
  hasContent: () => Boolean(input.value.trim() || imageAttachments.getImages().length),
  input,
  onError: showError,
  onQueued: () => {
    notifications.notify({
      message: t("It will wait for your confirmation after the connection returns."),
      title: t("Encrypted draft saved for reconnect"),
      type: "success",
    });
  },
  onSend: () => sendComposerInput({ altKey: false }),
  sendButton,
});
const slashMenu = setupComposerSlashMenu({
  input,
  container: skillSlashMenu,
  getCommands: () => commandCatalog.values(),
});
mobileDrafts
  .restoreCurrent()
  .then(() => mobileSendLater.restoreCurrent())
  .then(() =>
    consumeMobileShareTarget({
      addImageFiles: imageAttachments.addFiles,
      clientType: remoteAuth.clientType,
      input,
    }),
  )
  .then((sharedComposerContent) => {
    if (sharedComposerContent.status === "imported") {
      notifications.notify({
        type: "success",
        title: t("Shared content added to the composer"),
      });
    } else if (sharedComposerContent.status === "invalid") {
      notifications.notify({
        type: "warning",
        title: t("Shared content expired or could not be read"),
      });
    } else if (sharedComposerContent.status === "partial") {
      notifications.notify({
        type: "warning",
        title: t("Some shared images could not be added"),
      });
    }
  })
  .catch(() => {
    notifications.notify({
      type: "warning",
      title: t("Shared content expired or could not be read"),
    });
  });
setupCommandPalette({
  button: commandButton,
  palette: commandPalette,
  overlay: commandPaletteOverlay,
  list: commandList,
  commands: () => [
    {
      icon: "🗜️",
      label: t("Compact"),
      desc: t("Compact context to save tokens"),
      action: () => runtime.request({ type: "compact" }, target, { idempotencyKey: randomId() }),
      disabled: store.lifecycle === "working",
    },
    {
      icon: "⬇️",
      label: t("Expand All Tools"),
      desc: t("Expand all tool cards"),
      action: () => toolRenderer.expandAll(),
    },
    {
      icon: "⬆️",
      label: t("Collapse All Tools"),
      desc: t("Collapse all tool cards"),
      action: () => toolRenderer.collapseAll(),
    },
    {
      icon: "⚙️",
      label: t("Settings"),
      desc: t("Open ZiCode Studio Desktop settings"),
      action: () => settingsPanel?.openSettings("general"),
    },
    {
      icon: "?",
      label: t("Help"),
      desc: t("Show composer shortcuts"),
      action: () => runBuiltin("show_help"),
    },
    ...(pluginShell?.getCommandPaletteEntries() ?? []),
  ],
  onError: showError,
});
const settingsPanel = setupSettingsPanel({
  data,
  control,
  remoteAccessGateway,
  getWorkspaceId: () => target.workspaceId,
  configGateway: config,
  onModelConfigurationChanged: () => loadAvailableModels(),
  runtime,
  getTarget: () => target,
  onError: showError,
  notify: notifications.notify,
});
const helpCenter = setupHelpCenter();
const sceneIndicator = setupSceneIndicator({
  getTarget: () => target,
  openSettings: showSceneSettings,
  onWelcomeScene: (profile) => messageRenderer.setWelcomeScene(profile),
});
const artifactGateway = new ArtifactGateway({
  fetchImpl: hostFetch,
  location: window.location,
});
const financeWorkbench = setupFinanceWorkbench({
  configGateway: config,
  getTarget: () => target,
  openConfiguration: () => settingsPanel?.openSettings("configuration"),
  openFinanceApp: () => pluginShell?.activate("com.zicode.finance"),
  artifactGateway,
  notify: notifications.notify,
});
const pluginHostGateway = new PluginHostGateway({
  fetchImpl: hostFetch,
  location: window.location,
});
const pluginRegistry = createBuiltinPluginRegistry({
  hostGateway: pluginHostGateway,
});
const pluginCapabilityGateway = new PluginCapabilityGateway({
  fetchImpl: hostFetch,
  location: window.location,
});
const pluginViewHost = setupPluginViewHost({
  gateway: pluginHostGateway,
  capabilityGateway: pluginCapabilityGateway,
  getTarget: () => target,
  notify: notifications.notify,
  executeCommand: (commandId, args) => pluginShell?.executeCommand(commandId, args),
});
const notesGateway = new NotesGateway({
  fetchImpl: hostFetch,
  location: window.location,
});
const notesApp = setupNotesApp({
  gateway: notesGateway,
  getTarget: () => target,
  getProject: () => currentProjectInfo,
  notify: notifications.notify,
  onUseInChat: (note, selection = "") => {
    pluginShell?.activate("core.chat");
    let prompt;
    if (selection) {
      prompt = [
        `请基于笔记“${note.title}”中的以下选中文字继续讨论，只围绕这段文字，不要依赖过期上下文：`,
        "",
        selection,
        "",
        "我希望继续：",
      ].join("\n");
    } else {
      const reference = `zicode-note://${note.notebookId}/${note.id}`;
      prompt = [
        `请基于笔记“${note.title}”继续讨论。`,
        `请先调用 notes_get，参数 notebookId=${note.notebookId}、noteId=${note.id}，不要依赖过期的聊天上下文。`,
        `笔记引用：${reference}`,
        "\n我希望继续：",
      ].join("\n");
    }
    input.value = `${prompt}${input.value.trim() ? `\n${input.value.trim()}` : ""}`;
    mobileDrafts?.sync();
    input.focus();
  },
});
const artifactApp = setupArtifactApp({
  gateway: artifactGateway,
  getTarget: () => target,
  notify: notifications.notify,
});
const projectWorkspaceApp = setupProjectWorkspaceApp({
  notesGateway,
  artifactGateway,
  dataGateway: data,
  call: (operation, params, options) => config.call(operation, params, options),
  getTarget: () => target,
  openApp: (pluginId) => pluginShell?.activate(pluginId),
  onUseContextPack: (notes, { compare = false } = {}) => {
    pluginShell?.activate("core.chat");
    const references = notes
      .map((note) => `- ${note.title}: zicode-note://${note.notebookId}/${note.noteId}`)
      .join("\n");
    const instructions = notes
      .map((note) => `notes_get(notebookId=${note.notebookId}, noteId=${note.noteId})`)
      .join("、");
    input.value = [
      compare
        ? "请比较以下笔记，指出冲突、时间差异、来源差异和可验证结论。"
        : "请综合以下上下文包继续分析。",
      `请先分别调用 ${instructions}，不要依赖过期聊天上下文。`,
      references,
      "",
      input.value.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    mobileDrafts?.sync();
    input.focus();
  },
  notify: notifications.notify,
});
const taskCenterApp = setupTaskCenterApp({
  call: (operation, params, options) => config.call(operation, params, options),
  runtime,
  cancelRuntimeUi: (runtimeTarget) => extensionUi.cancelSession(runtimeTarget),
  openApp: (pluginId) => pluginShell?.activate(pluginId),
  notify: notifications.notify,
});
const automationApp = setupAutomationApp({
  call: (operation, params, options) => config.call(operation, params, options),
  getTarget: () => target,
  openApp: (pluginId) => pluginShell?.activate(pluginId),
  notify: notifications.notify,
});
pluginShell = setupPluginShell({
  registry: pluginRegistry,
  capabilityGateway: pluginCapabilityGateway,
  commandGateway: pluginHostGateway,
  getTarget: () => target,
  getProject: () => currentProjectInfo,
  openSettings: (tab = "general") => settingsPanel?.openSettings(tab),
  openHelp: () => helpCenter?.open(),
  settingsApp: settingsPanel,
  helpApp: helpCenter,
  notesApp,
  financeApp: financeWorkbench,
  artifactApp,
  builtinApps: {
    "com.zicode.projects": projectWorkspaceApp,
    "com.zicode.tasks": taskCenterApp,
    "com.zicode.automation": automationApp,
  },
  pluginViewHost,
  openCommandPalette: () => commandButton?.click(),
  openFinanceWorkbench: () => financeWorkbench?.openPanel(),
  installDeveloperPlugin: globalThis.__TAURI__?.core?.invoke
    ? () => globalThis.__TAURI__.core.invoke("select_and_install_developer_plugin")
    : null,
  selectSignedPlugin: globalThis.__TAURI__?.core?.invoke
    ? () => globalThis.__TAURI__.core.invoke("select_signed_plugin_package")
    : null,
  installSignedPlugin: globalThis.__TAURI__?.core?.invoke
    ? (packagePath, trustPublisher) =>
        globalThis.__TAURI__.core.invoke("install_signed_plugin_package", {
          packagePath,
          trustPublisher,
        })
    : null,
  rollbackSignedPlugin: globalThis.__TAURI__?.core?.invoke
    ? (pluginId, version) =>
        globalThis.__TAURI__.core.invoke("rollback_signed_plugin_package", {
          pluginId,
          version,
        })
    : null,
  revokePublisher: globalThis.__TAURI__?.core?.invoke
    ? (keyId) => globalThis.__TAURI__.core.invoke("revoke_plugin_publisher", { keyId })
    : null,
  notify: notifications.notify,
});

window.addEventListener("popstate", () => {
  const navigation = resolveHistoryNavigation(target, window.location.pathname);
  if (navigation.type === "switch_session") {
    void switchSession(navigation.sessionId, { updateHistory: false }).catch(showError);
  } else if (navigation.type === "reload") {
    window.location.reload();
  }
});

messagesElement.addEventListener("savechattonotes", async (event) => {
  const button = event.target?.closest?.(".message")?.querySelector?.(".message-note-btn");
  if (button) button.disabled = true;
  try {
    await notesApp?.captureChatExchange({
      ...event.detail,
      sessionId: target.sessionId,
    });
    pluginShell?.activate("com.zicode.notes");
  } catch (error) {
    showError(error);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
});

messagesElement.addEventListener("organizechattonotes", async (event) => {
  const button = event.target?.closest?.(".message")?.querySelector?.(".message-organize-btn");
  if (button) button.disabled = true;
  try {
    if (pendingOrganizeNote) return;
    const skillResponse = await fetch("/skills/conversation-note/SKILL.md", {
      cache: "no-store",
    });
    if (!skillResponse.ok) {
      throw new Error(t("The conversation-note skill could not be loaded"));
    }
    const skillText = await skillResponse.text();
    const transcript = buildConversationTranscript(currentHistoryMessages);
    if (!transcript.trim()) {
      throw new Error(t("There is no conversation to organize"));
    }
    const firstUserMessage =
      [...currentHistoryMessages].reverse().find((message) => message.role === "user")
        ?.content ?? "";
    const prompt = [
      t("Organize conversation into note"),
      t("Use the conversation-note skill below and output only the note body in Markdown."),
      "",
      `===== SKILL =====\n${skillText}`,
      `===== CONVERSATION =====\n${transcript}`,
    ].join("\n\n");
    pendingOrganizeNote = {
      question: fullMessageText(firstUserMessage),
    };
    await runtime.request(
      { type: "prompt", message: prompt },
      target,
      { idempotencyKey: randomId() },
    );
  } catch (error) {
    pendingOrganizeNote = null;
    showError(error);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
});
setupAppUpdater({ settingsPanel });
setupNewSessionButton({
  data,
  workspaceId: target.workspaceId,
  onError: showError,
  fetchImpl: hostFetch,
});
setupOpenFolderButton({ onError: showError });
setupLanQr({ control });
setupAppKeyboardShortcuts({
  input,
  abort: abortCurrentRun,
  isWorking: () => store.lifecycle === "working",
  openCommandPalette: () => commandButton?.click(),
});
window.addEventListener("zicode:open-note", (event) => {
  const { notebookId, noteId } = event.detail ?? {};
  if (!notebookId || !noteId) return;
  pluginShell?.activate("com.zicode.notes");
  notesApp?.openNote?.(notebookId, noteId).catch(showError);
});
window.addEventListener("zicode:open-project", () => {
  pluginShell?.activate("com.zicode.projects");
});
window.addEventListener("zicode:open-artifact", (event) => {
  const { artifactId } = event.detail ?? {};
  if (!artifactId) return;
  pluginShell?.activate("com.zicode.artifacts");
  artifactApp?.openArtifact?.(artifactId).catch(showError);
});
window.addEventListener("zicode:open-session", (event) => {
  const { sessionId, workspaceId, projectPath } = event.detail ?? {};
  if (!sessionId) return;
  pluginShell?.activate("core.chat");
  if (workspaceId && workspaceId !== target.workspaceId) {
    openSessionInProject({ id: sessionId, workspaceId, projectPath }).catch(showError);
  } else {
    switchSession(sessionId).catch(showError);
  }
});
convNav.mount();

try {
  const bootstrappedTarget = await withTransientRetry(() => loadBootstrapTarget(route));
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

/** Retry transient bootstrap/connection failures so the client self-heals
 *  without a manual page refresh. Permanent client errors (4xx other than
 *  retryable 408/429) fail fast. */
async function withTransientRetry(resolve, { attempts = 3, baseDelayMs = 800 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await resolve();
    } catch (error) {
      lastError = error;
      const status = error?.status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw error;
      }
      if (attempt < attempts) {
        await new Promise((done) => setTimeout(done, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

async function requestBootstrapTarget(currentRoute) {
  const query = new URLSearchParams({
    workspaceId: currentRoute.workspaceId,
    sessionId: currentRoute.sessionId,
  });
  const response = await hostFetch(`/v2/bootstrap?${query}`);
  if (!response.ok) {
    // A stale route (e.g. a session created by a previous runtime that no
    // longer exists) makes every operation fail. Self-heal by falling back to
    // the most recent session in the workspace instead of leaving the client
    // stuck on a "runtime stopped or unavailable" error.
    if (response.status === 404) {
      try {
        const list = await hostFetch(`/v2/sessions?workspaceId=${currentRoute.workspaceId}`)
          .then((sessionsResponse) => (sessionsResponse.ok ? sessionsResponse.json() : null))
          .catch(() => null);
        const latest = list?.sessions?.[0];
        if (latest?.id && latest.id !== currentRoute.sessionId) {
          return requestBootstrapTarget({
            name: "session",
            workspaceId: currentRoute.workspaceId,
            sessionId: latest.id,
          });
        }
      } catch {
        // Fall through to the generic error below.
      }
    }
    const error = new Error(
      response.status === 503
        ? "ZiCode Studio Desktop is offline. Open it on your computer and retry."
        : "This ZiCode Studio Desktop runtime is stopped or unavailable",
    );
    error.status = response.status;
    if (response.status === 503) error.code = "desktop_offline";
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
    onOpenApp: (pluginId) => pluginShell?.activate(pluginId),
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
      if (session?.id === target.sessionId && !revealHistoryForSearchIfNeeded()) {
        applyActiveSearchHighlight();
      }
    },
    onQueryChange: (query) => {
      activeSearchQuery = query || "";
      if (!revealHistoryForSearchIfNeeded()) {
        applyActiveSearchHighlight({ scrollToFirst: false });
      }
    },
    onError: showError,
  });
}

async function switchSession(sessionId, { updateHistory = true } = {}) {
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
  if (updateHistory) {
    history.pushState(
      {
        ...(history.state && typeof history.state === "object" ? history.state : {}),
        [PLUGIN_HISTORY_STATE_KEY]: pluginShell?.getActivePluginId() || "core.chat",
      },
      "",
      appRoutePath({
        name: "session",
        workspaceId: target.workspaceId,
        sessionId: target.sessionId,
      }),
    );
  }
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
    await openSessionInProjectViaHost(session, hostFetch);
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
  mobileDrafts?.sync();
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
    resolveWorkspace: (projectPath) => resolveWorkspaceViaHost(projectPath, hostFetch),
    spawnSession: (workspaceId) =>
      spawnSessionViaHost(workspaceId, getSelectedSceneId(), hostFetch),
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
      if (pluginShell?.getActivePluginId() !== "core.chat") {
        pluginShell?.setActivityBadge("core.chat", { count: 1, tone: "warning" });
      }
      break;
    case "agent_settled":
    case "agent_end":
      sidebar?.setStreaming(sessionId, false);
      sidebar?.markUnread(sessionId);
      if (pluginShell?.getActivePluginId() !== "core.chat") {
        pluginShell?.setActivityBadge("core.chat", { count: 1, tone: "success" });
      }
      if (frame.event?.type === "agent_end") dispatchedInstances.delete(frame.target?.instanceId);
      break;
    case "message_end":
      if (frame.event.message?.role === "assistant") {
        sidebar?.markUnread(sessionId);
        await recordDispatchedTaskUsage(frame);
      }
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
  await updateSuperAgentTask(window.__picotConfigCall, taskId, (task) =>
    markTaskChildSessionBound(task, { childSessionId: boundSessionId }),
  ).catch((error) => console.warn("[SuperAgent] failed to bind child session:", error));
}

async function recordDispatchedTaskUsage(frame) {
  const taskId = dispatchedInstances.get(frame.target?.instanceId);
  const delta = Number(frame.event?.message?.usage?.cost?.total);
  if (!taskId || !Number.isFinite(delta) || delta <= 0) return;
  let exceeded = false;
  let budget = null;
  await updateSuperAgentTask(window.__picotConfigCall, taskId, (task) => {
    const totalCost = Number(task.totalCost || 0) + delta;
    budget = Number(task.budget);
    const next = { ...task, totalCost };
    if (Number.isFinite(budget) && budget > 0 && totalCost >= budget) {
      exceeded = true;
      return markTaskFinished(next, {
        status: "failed",
        failReason: t("Task budget reached; the child run was stopped."),
      });
    }
    return next;
  });
  if (!exceeded) return;
  await runtime.request({ type: "abort" }, frame.target).catch(() => {});
  await extensionUi.cancelSession(frame.target).catch(() => {});
  notifications.notify({
    title: t("Task budget reached"),
    message: `$${Number(budget).toFixed(2)}`,
    type: "warning",
  });
  pluginShell?.setActivityBadge("com.zicode.tasks", { count: 1, tone: "warning" });
}

function setupFileBrowser() {
  const sidebar = document.getElementById("file-sidebar");
  const fileList = document.getElementById("file-list");
  const pathEl = document.getElementById("file-sidebar-path");
  if (!sidebar || !fileList || !pathEl) return;

  // On the mobile shell the right file panel is an off-canvas drawer toggled
  // from the activity bar; start it collapsed so it never covers the chat.
  if (
    window.matchMedia?.("(max-width: 768px), (max-height: 520px) and (pointer: coarse)")?.matches
  ) {
    sidebar.classList.add("collapsed");
  }

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
      const root = info?.info?.path ?? "";
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

async function sendComposerInput({ altKey, retried = false } = {}) {
  const value = input.value;
  await imageAttachments.whenIdle();
  const images = imageAttachments.getImages();
  if (!value.trim() && images.length === 0) return;
  if (remoteAuth.clientType === "remote" && !mobileSendLater?.isConnected()) {
    const queued = await mobileSendLater?.queueCurrent();
    if (queued?.status !== "queued") {
      throw new Error(
        t("Could not save this draft for reconnect. Keep this page open and try again."),
      );
    }
    input.focus();
    return;
  }
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
  await enforceProjectBudget(value);
  lastRetryableRequest = { value, images: [...images], altKey: Boolean(altKey) };
  input.value = "";
  input.scrollTop = 0;
  imageAttachments.clear();
  try {
    await runtime.request(intent.command, target, { idempotencyKey: randomId() });
    await mobileDrafts?.clearAfterSubmit();
    mobileSendLater?.sent();
  } catch (error) {
    const staleInstance =
      !retried &&
      (error?.code === "unknown_instance" ||
        String(error?.message || error).includes("UnknownInstance"));
    if (staleInstance) {
      try {
        // The bound runtime instance died (e.g. the host restarted while this
        // client was connected). Re-resolve the session's live instance and
        // retry the send once instead of failing with UnknownInstance.
        const nextTarget = await loadBootstrapTarget({
          name: "session",
          workspaceId: target.workspaceId,
          sessionId: target.sessionId,
        });
        await adoptTarget(nextTarget, { updateRoute: false });
        await runtime.request(intent.command, target, { idempotencyKey: randomId() });
        await mobileDrafts?.clearAfterSubmit();
        mobileSendLater?.sent();
        return;
      } catch {
        // Fall through to the normal error path below.
      }
    }
    input.value = value;
    imageAttachments.setImages(images);
    mobileDrafts?.sync();
    throw error;
  }
}

async function enforceProjectBudget(prompt) {
  let profile;
  try {
    profile = await projectWorkspaceApp.getProfile();
  } catch {
    profile = readProjectWorkspaceProfile({ target });
  }
  const budget = Number(profile.budget);
  if (!Number.isFinite(budget) || budget <= 0) return;
  const model = availableModels.find((candidate) => candidate.id === currentModelId);
  const estimated = estimateRequestCost(model, {
    inputTokens: Math.ceil(String(prompt || "").length / 4),
    outputTokens: 2000,
  });
  const projected = sessionTotalCost + (estimated ?? 0);
  if (sessionTotalCost >= budget || projected > budget) {
    const error = new Error(
      `${t("Session budget reached")} ($${budget.toFixed(2)}). ${t("Increase the project budget or start a new session.")}`,
    );
    error.code = "session_budget_exceeded";
    throw error;
  }
}

function runBuiltin(action) {
  if (action === "open_settings") settingsPanel?.openSettings("general");
  else if (action === "open_tree") document.dispatchEvent(new CustomEvent("picot:open-tree"));
  else if (action === "show_help") {
    void helpCenter?.open();
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
        appendLiveMessage(event.message);
      } else if (event.message?.role === "assistant") {
        streamingElement = messageRenderer.renderAssistantMessage(event.message, true);
        convNav.notifyStreamingStart();
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
      if (event.message?.role === "assistant") {
        if (streamingElement) {
          messageRenderer.updateStreamingMessage(streamingElement, event.message.content ?? []);
          messageRenderer.finalizeStreamingMessage(streamingElement, event.message.usage ?? null);
        }
        if (event.message.stopReason === "error" || event.message.errorMessage) {
          messageRenderer.renderAssistantError(event.message);
        }
        contextUsage.setUsage(event.message.usage ?? null, currentModelContextWindow);
        setSessionCost(sessionTotalCost + (event.message.usage?.cost?.total ?? 0));
        appendLiveMessage(event.message);
        streamingElement = null;
        convNav.notifyNewMessage();
        if (pendingOrganizeNote) {
          const pending = pendingOrganizeNote;
          pendingOrganizeNote = null;
          const answer = fullMessageText(event.message?.content ?? []);
          if (answer.trim()) {
            try {
              await notesApp?.captureChatExchange({
                question: pending.question,
                answer,
                sessionId: target.sessionId,
              });
              pluginShell?.activate("com.zicode.notes");
            } catch (error) {
              showError(error);
            }
          }
        }
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
    nextTarget.instanceId !== previousTarget.instanceId ||
    nextTarget.sceneId !== previousTarget.sceneId;
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
  // Apply the persisted auto-compaction preference to the freshly adopted
  // session runtime (the toggle also sends it live on change).
  try {
    if (localStorage.getItem("picot-settings-auto-compact") === "true") {
      void runtime
        .request(
          { type: "set_auto_compaction", enabled: true },
          target,
          { idempotencyKey: randomId() },
        )
        .catch(showError);
    }
  } catch {
    // Preference application is best-effort; storage may be unavailable.
  }
  const migrateTemporaryDraft =
    sessionChanged &&
    previousTarget.workspaceId === nextTarget.workspaceId &&
    previousTarget.sessionId?.startsWith("temporary-");
  if (sessionChanged && !migrateTemporaryDraft) imageAttachments?.clear();
  void mobileDrafts
    ?.setTarget(target, { preserveInput: migrateTemporaryDraft })
    .then(() => mobileSendLater?.setTarget())
    .catch(() => {});
  settingsPanel?.setTarget(target);
  sceneIndicator?.setTarget(target);
  financeWorkbench?.setTarget(target);
  pluginShell?.setTarget(target);
  if (
    nextTarget.workspaceId !== previousTarget.workspaceId ||
    !currentProjectInfo
  ) {
    void refreshCurrentProjectInfo();
  }
  store = createSessionStore(target);
  composer?.setQueue(store.queue);
  todoMirrorPanel.clear();
  streamingElement = null;
  adapter.subscribeTarget(target);
  sidebar?.setActive(target.sessionId);
  await extensionUi.setForegroundSession(target.sessionId, { flush: false });
}

function projectNameFromPath(path, fallback) {
  const trimmed = String(path ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.split(/[\\/]/).filter(Boolean).at(-1) || fallback;
}

async function refreshCurrentProjectInfo() {
  const workspaceId = target.workspaceId;
  if (!workspaceId) {
    currentProjectInfo = null;
    notesApp?.setProject?.(null);
    pluginShell?.refreshSidebar?.();
    return;
  }
  let path = "";
  try {
    const info = await data.workspaceInfo(workspaceId);
    path = info?.info?.path ?? "";
  } catch (error) {
    console.warn("[Native] Failed to resolve project info:", error);
  }
  currentProjectInfo = {
    id: workspaceId,
    path,
    name: projectNameFromPath(path, workspaceId),
  };
  notesApp?.setProject?.(currentProjectInfo);
  pluginShell?.refreshSidebar?.();
}

function historyBatchSize() {
  const constrained =
    remoteAuth.clientType === "remote" || window.matchMedia?.(MOBILE_SHELL_QUERY)?.matches;
  return constrained ? 60 : 120;
}

function revealEarlierHistory() {
  if (!historyWindow?.revealPrevious()) return;
  const previousScrollHeight = messagesElement.scrollHeight;
  const previousScrollTop = messagesElement.scrollTop;
  historyRevealCompleted = historyWindow.hiddenCount === 0;
  renderHistory(currentHistoryMessages, { preserveScroll: true });

  requestAnimationFrame(() => {
    const addedHeight = Math.max(0, messagesElement.scrollHeight - previousScrollHeight);
    messagesElement.scrollTop = previousScrollTop + addedHeight;
    const focusTarget = messagesElement.querySelector(
      ".history-window-load, .history-window-loaded",
    );
    focusTarget?.focus({ preventScroll: true });
  });
}

function revealHistoryForSearchIfNeeded() {
  if (!activeSearchQuery.trim() || !historyWindow?.hiddenCount) return false;
  historyWindow.revealAll();
  historyRevealCompleted = false;
  renderHistory(currentHistoryMessages, { preserveScroll: true });
  return true;
}

function renderHistory(messages, { preserveScroll = false } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const windowTargetKey = `${target.workspaceId}\u0000${target.sessionId}`;
  const resetWindow = historyWindowTargetKey !== windowTargetKey;
  if (!historyWindow || resetWindow) {
    historyWindow = createHistoryWindow({ batchSize: historyBatchSize() });
    historyWindowTargetKey = windowTargetKey;
    historyRevealCompleted = false;
  }
  currentHistoryMessages = source;
  historyWindow.setMessages(source, { reset: resetWindow });
  if (activeSearchQuery.trim()) historyWindow.revealAll();

  messageRenderer.clear();
  toolRenderer.clear();
  if (source.length === 0) {
    messageRenderer.renderWelcome();
    sceneIndicator?.render();
    applyActiveSearchHighlight({ scrollToFirst: false });
    return;
  }

  if (historyWindow.hiddenCount > 0) {
    messageRenderer.appendHistoryWindowNotice(historyWindow.hiddenCount);
  } else if (historyRevealCompleted) {
    messageRenderer.appendHistoryLoadedStatus();
  }

  // Pre-index tool results by toolCallId for O(1) lookup
  const toolResults = new Map();
  for (const message of source) {
    if (message.role === "toolResult") {
      toolResults.set(message.toolCallId, message);
    }
  }

  for (const message of historyWindow.visibleMessages) {
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
      if (message.stopReason === "error" || message.errorMessage) {
        messageRenderer.renderAssistantError(message);
      }
    }
  }
  const highlighted = applyActiveSearchHighlight();
  if (highlighted === 0 && !preserveScroll) messageRenderer.forceScrollToBottom();
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

function fullMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === "text")
      .map((block) => block.text ?? "")
      .join("\n");
  }
  return "";
}

function buildConversationTranscript(messages) {
  const lines = [];
  for (const message of [...(messages ?? [])].slice(-60)) {
    const text = fullMessageText(message?.content ?? "").trim();
    if (!text) continue;
    const role =
      message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : null;
    if (!role) continue;
    lines.push(`${role}: ${text.slice(0, 3000)}`);
  }
  return lines.join("\n\n");
}

// Keep the live conversation in sync with the history list used by
// organize-to-note. renderHistory() seeds currentHistoryMessages from the
// snapshot, but messages that arrive after load are only rendered through the
// feed; without this the transcript would miss every live exchange.
function appendLiveMessage(message) {
  if (!message?.role) return;
  const id = message.id ?? message.entryId ?? message.entry_id ?? null;
  if (id && currentHistoryMessages.some((candidate) => (candidate.id ?? candidate.entryId ?? candidate.entry_id) === id)) {
    return;
  }
  currentHistoryMessages.push(message);
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
  // Keep the status reflecting the actual connection state; the adapter's
  // connection listener owns "Connected"/"Disconnected". Showing an error
  // must not pretend the WebSocket went down.
  messageRenderer.renderError(error?.message || String(error));
}

messagesElement.addEventListener("openmodelsettings", () => {
  settingsPanel?.openSettings("configuration");
});

messagesElement.addEventListener("retrylastrequest", () => {
  if (!lastRetryableRequest || store.lifecycle === "working") {
    notifications.notify({
      type: "warning",
      title: t("Request cannot be retried yet"),
      message: store.lifecycle === "working" ? t("Wait for the current task to finish.") : "",
    });
    return;
  }
  input.value = lastRetryableRequest.value;
  imageAttachments.setImages(lastRetryableRequest.images);
  sendComposerInput({ altKey: lastRetryableRequest.altKey }).catch(showError);
});

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
    const translatedLevel = t(currentThinkingLevel);
    thinkingBtn.textContent = `${t("Think")} ${translatedLevel}`;
    thinkingBtn.className = `thinking-tag${currentThinkingLevel === "off" ? " off" : ""}`;
    thinkingBtn.title = t("Thinking effort controls reasoning depth. Click to cycle.");
    thinkingBtn.setAttribute(
      "aria-label",
      t("Thinking effort: {level}. Click to cycle reasoning depth.").replace(
        "{level}",
        translatedLevel,
      ),
    );
  }
  // Sync settings panel radio group
  settingsPanel?.thinkingControl?.updateUI(level);
}

window.addEventListener("zicode:locale-changed", () => {
  updateComposerThinking(currentThinkingLevel);
  sidebar?.render?.();
});

function loadAvailableModels() {
  if (modelLoadPromise) return modelLoadPromise;
  modelsLoading = true;
  modelLoadError = "";
  if (!modelDropdownMenu?.classList.contains("hidden")) modelDropdownFeed.render();
  modelLoadPromise = (async () => {
    try {
      const result = await runtime.request({ type: "get_available_models" }, target);
      const runtimeModels = result?.response?.data?.models ?? [];
      availableModels = await applyConfiguredModelVisibility(runtimeModels);
      if (!currentModelContextWindow) {
        currentModelContextWindow = findModelContextWindow(currentModelId);
        contextUsage.setContextWindowSize(currentModelContextWindow);
      }
    } catch (error) {
      modelLoadError = error?.message || t("Models could not be loaded");
      console.warn("[Native] Failed to load available models:", error);
    } finally {
      modelsLoading = false;
      modelLoadPromise = null;
      if (!modelDropdownMenu?.classList.contains("hidden")) {
        modelDropdownFeed.render();
        requestAnimationFrame(() => modelDropdownFeed.focusSearch());
      }
    }
  })();
  return modelLoadPromise;
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

function openModelDropdown() {
  if (!modelDropdownMenu) return;
  modelDropdownFeed.render();
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

// WebView2 blocks target="_blank" navigations (there is no new-window
// handler), so links rendered in markdown (messages, note sources, web
// clips) and attachment links would do nothing on desktop. Route them
// through the host's open_external command into the system browser.
document.addEventListener("click", (event) => {
  if (event.defaultPrevented) return;
  const anchor = event.target?.closest("a[href]");
  if (anchor?.target !== "_blank") return;
  const href = anchor.getAttribute("href") || "";
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
  event.preventDefault();
  const url = /^https?:\/\//i.test(href) ? href : new URL(href, location.origin).href;
  control.openExternal(url).catch(() => {
    globalThis.open(url, "_blank", "noopener,noreferrer");
  });
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
