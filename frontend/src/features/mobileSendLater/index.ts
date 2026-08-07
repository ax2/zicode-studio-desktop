import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { t } from "../../shared/i18n";
import { MobileSendLaterBanner } from "./MobileSendLaterApp";

interface SendLaterDrafts {
  clearQueued(): Promise<unknown>;
  markQueued(): Promise<{ status: string; queuedAt?: number }>;
  readQueued(): Promise<unknown>;
}

interface SendLaterAdapter {
  isConnected?(): boolean;
  setConnectionListener?(listener: (connected: boolean) => void): () => void;
}

export interface MobileSendLaterHandle {
  dispose(): void;
  isConnected(): boolean;
  queueCurrent(): Promise<{ status: string; queuedAt?: number }>;
  restoreCurrent(): Promise<{ status: string; queuedAt?: number }>;
  sent(): void;
  setTarget(): Promise<{ status: string; queuedAt?: number }>;
}

function inertController(): MobileSendLaterHandle {
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
}: {
  adapter?: SendLaterAdapter;
  clientType?: string;
  composerRoot?: HTMLElement | null;
  drafts?: SendLaterDrafts;
  getTarget?: () => { workspaceId?: string; sessionId?: string } | undefined;
  hasContent?: () => boolean;
  input?: HTMLElement | null;
  onError?: (error: unknown) => void;
  onQueued?: () => void;
  onSend?: () => Promise<unknown>;
  sendButton?: HTMLElement | null;
  documentRef?: Document;
  windowRef?: Window;
} = {}): MobileSendLaterHandle {
  if (
    clientType !== "remote" ||
    !composerRoot ||
    !drafts ||
    typeof getTarget !== "function" ||
    typeof onSend !== "function"
  ) {
    return inertController();
  }

  const draftsApi = drafts;
  const getTargetRef = getTarget;
  const hasContentRef = hasContent;
  const onSendRef = onSend;

  let active = false;
  let busy = false;
  let connected = Boolean(adapter?.isConnected?.());
  let disposed = false;
  let generation = 0;

  const wrapper = documentRef.createElement("div");
  wrapper.dataset.mobileSendLaterRoot = "";
  composerRoot.parentElement?.insertBefore(wrapper, composerRoot);
  const root: Root = createRoot(wrapper);

  function targetKey(value = getTargetRef()) {
    return JSON.stringify([value?.workspaceId || "", value?.sessionId || ""]);
  }

  function render() {
    if (disposed) return;
    flushSync(() => {
      root.render(
        createElement(MobileSendLaterBanner, {
          active,
          connected,
          busy,
          onSendNow: () => void sendQueued(),
          onKeepDraft: () => void keepAsDraft(),
        }),
      );
    });
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
    const queued = await draftsApi.readQueued();
    if (
      disposed ||
      expectedGeneration !== generation ||
      expectedTarget !== targetKey()
    ) {
      return { status: "skipped" };
    }
    if (queued && typeof hasContentRef === "function" && !hasContentRef()) {
      await draftsApi.clearQueued();
      active = false;
      render();
      return { status: "empty" };
    }
    active = Boolean(queued);
    render();
    return active
      ? { queuedAt: (queued as { queuedAt?: number })?.queuedAt, status: "restored" }
      : { status: "empty" };
  }

  async function queueCurrent() {
    if (disposed) return { status: "ignored" };
    const wasActive = active;
    const result = await draftsApi.markQueued();
    if (result?.status !== "queued") return result;
    active = true;
    render();
    if (!wasActive) onQueued();
    return result;
  }

  async function keepAsDraft() {
    await draftsApi.clearQueued();
    active = false;
    render();
    input?.focus();
  }

  async function sendQueued() {
    if (!active || !connected || busy) return;
    busy = true;
    render();
    try {
      await onSendRef();
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
  render();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      removeConnectionListener?.();
      windowRef.removeEventListener("zicode:locale-changed", onLocaleChanged);
      root.unmount();
      wrapper.remove();
    },
    isConnected: () => connected,
    queueCurrent,
    restoreCurrent,
    sent,
    setTarget,
  };
}
