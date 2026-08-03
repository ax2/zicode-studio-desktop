// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupMobileSendLater } from "./mobile-send-later.js";

function adapterHarness() {
  const listeners = new Set();
  return {
    adapter: {
      setConnectionListener(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit(connected) {
      for (const listener of listeners) listener(connected);
    },
  };
}

function setup({ queued = null, content = true } = {}) {
  document.body.innerHTML = `
    <form><div id="composer"></div><button id="send" type="submit"></button></form>
    <textarea id="input"></textarea>
  `;
  const connection = adapterHarness();
  const drafts = {
    clearQueued: vi.fn(async () => {}),
    markQueued: vi.fn(async () => ({ queuedAt: 100, status: "queued" })),
    readQueued: vi.fn(async () => queued),
  };
  const onSend = vi.fn(async () => {});
  const view = setupMobileSendLater({
    adapter: connection.adapter,
    clientType: "remote",
    composerRoot: document.querySelector("#composer"),
    drafts,
    getTarget: () => ({ sessionId: "session-1", workspaceId: "workspace-1" }),
    hasContent: () => content,
    input: document.querySelector("#input"),
    onSend,
    sendButton: document.querySelector("#send"),
    windowRef: window,
  });
  return { connection, drafts, onSend, view };
}

describe("mobile send later", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("saves an explicit offline send intent without sending automatically", async () => {
    const { connection, drafts, onSend, view } = setup();
    connection.emit(false);

    expect(await view.queueCurrent()).toEqual({ queuedAt: 100, status: "queued" });
    const banner = document.querySelector(".mobile-send-later");
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toMatch(/will not send automatically|不会自动发送/);
    expect(document.querySelector("#send").getAttribute("aria-label")).toMatch(
      /Save draft|保存草稿/,
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(drafts.markQueued).toHaveBeenCalledOnce();

    connection.emit(true);
    expect(banner.textContent).toMatch(/Connection restored|连接已恢复/);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("requires a user click after reconnect and can keep the content as a normal draft", async () => {
    const { connection, drafts, onSend, view } = setup({ queued: { queuedAt: 50 } });
    expect(await view.restoreCurrent()).toEqual({ queuedAt: 50, status: "restored" });
    connection.emit(true);

    document.querySelector(".mobile-send-later-actions button").click();
    await vi.waitFor(() => expect(onSend).toHaveBeenCalledOnce());

    await view.queueCurrent();
    document.querySelectorAll(".mobile-send-later-actions button")[1].click();
    await vi.waitFor(() => expect(drafts.clearQueued).toHaveBeenCalledOnce());
    expect(document.querySelector(".mobile-send-later").hidden).toBe(true);
  });

  it("drops an orphaned marker and stays inactive on desktop", async () => {
    const { drafts, view } = setup({ content: false, queued: { queuedAt: 50 } });
    expect(await view.restoreCurrent()).toEqual({ status: "empty" });
    expect(drafts.clearQueued).toHaveBeenCalledOnce();

    const desktop = setupMobileSendLater({ clientType: "desktop" });
    expect(await desktop.queueCurrent()).toEqual({ status: "ignored" });
  });
});
