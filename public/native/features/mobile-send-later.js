import { t } from "../../i18n.js";

function inertController() {
  return {
    dispose() {},
    isConnected: () => true,
    queueCurrent: async () => ({ status: "ignored" }),
    restoreCurrent: async () => ({ status: "ignored" }),
    sent() {},
    setTarget: async () => ({ status: "ignored" }),
  };
}

export function setupMobileSendLater({
  adapter,
  clientType,
  composerRoot,
  drafts,
  getTarget,
  hasContent,
  input,
  onError = console.error,
  onQueued = () => {},
  onSend,
  sendButton,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  if (
    clientType !== "remote" ||
    !composerRoot ||
    !drafts ||
    typeof getTarget !== "function" ||
    typeof onSend !== "function"
  ) {
    return inertController();
  }

  let active = false;
  let busy = false;
  let connected = Boolean(adapter?.isConnected?.());
  let disposed = false;
  let generation = 0;

  const banner = documentRef.createElement("aside");
  banner.className = "mobile-send-later";
  banner.hidden = true;
  banner.setAttribute("aria-live", "polite");

  const copy = documentRef.createElement("div");
  copy.className = "mobile-send-later-copy";
  const title = documentRef.createElement("strong");
  const message = documentRef.createElement("span");
  copy.append(title, message);

  const actions = documentRef.createElement("div");
  actions.className = "mobile-send-later-actions";
  const sendNow = documentRef.createElement("button");
  sendNow.type = "button";
  sendNow.className = "ui-button ui-button--primary ui-button--sm";
  const keepDraft = documentRef.createElement("button");
  keepDraft.type = "button";
  keepDraft.className = "ui-button ui-button--ghost ui-button--sm";
  actions.append(sendNow, keepDraft);
  banner.append(copy, actions);
  composerRoot.parentElement?.insertBefore(banner, composerRoot);

  function targetKey(value = getTarget()) {
    return JSON.stringify([value?.workspaceId || "", value?.sessionId || ""]);
  }

  function render() {
    banner.hidden = !active;
    title.textContent = t(connected ? "Ready to send" : "Saved for reconnect");
    message.textContent = t(
      connected
        ? "Connection restored. Review the draft, then send it."
        : "The encrypted draft is saved on this device and will not send automatically.",
    );
    sendNow.textContent = t("Send now");
    sendNow.disabled = busy || !connected;
    sendNow.setAttribute("aria-busy", String(busy));
    keepDraft.textContent = t("Keep as draft");
    keepDraft.disabled = busy;
    if (sendButton) {
      const label = t(connected ? "Send message" : "Save draft for reconnect");
      sendButton.title = label;
      sendButton.setAttribute("aria-label", label);
    }
  }

  async function restoreCurrent() {
    if (disposed) return { status: "ignored" };
    const expectedGeneration = ++generation;
    const expectedTarget = targetKey();
    const queued = await drafts.readQueued();
    if (
      disposed ||
      expectedGeneration !== generation ||
      expectedTarget !== targetKey()
    ) {
      return { status: "skipped" };
    }
    if (queued && typeof hasContent === "function" && !hasContent()) {
      await drafts.clearQueued();
      active = false;
      render();
      return { status: "empty" };
    }
    active = Boolean(queued);
    render();
    return active ? { queuedAt: queued.queuedAt, status: "restored" } : { status: "empty" };
  }

  async function queueCurrent() {
    if (disposed) return { status: "ignored" };
    const wasActive = active;
    const result = await drafts.markQueued();
    if (result?.status !== "queued") return result;
    active = true;
    render();
    if (!wasActive) onQueued();
    return result;
  }

  async function keepAsDraft() {
    await drafts.clearQueued();
    active = false;
    render();
    input?.focus();
  }

  async function sendQueued() {
    if (!active || !connected || busy) return;
    busy = true;
    render();
    try {
      await onSend();
    } catch (error) {
      onError(error);
    } finally {
      busy = false;
      render();
    }
  }

  function sent() {
    active = false;
    render();
  }

  async function setTarget() {
    generation += 1;
    active = false;
    render();
    return restoreCurrent();
  }

  const removeConnectionListener = adapter?.setConnectionListener?.((value) => {
    connected = Boolean(value);
    render();
  });
  const onLocaleChanged = () => render();
  windowRef.addEventListener("zicode:locale-changed", onLocaleChanged);
  sendNow.addEventListener("click", sendQueued);
  keepDraft.addEventListener("click", keepAsDraft);
  render();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      removeConnectionListener?.();
      windowRef.removeEventListener("zicode:locale-changed", onLocaleChanged);
      banner.remove();
    },
    isConnected: () => connected,
    queueCurrent,
    restoreCurrent,
    sent,
    setTarget,
  };
}
