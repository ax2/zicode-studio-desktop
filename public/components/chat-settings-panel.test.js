import { beforeEach, describe, expect, it, vi } from "vitest";

import "./chat-settings-panel.js";

async function flushPromises(count = 6) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

describe("chat-settings-panel", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete window.__picotConfigCall;
    vi.restoreAllMocks();
  });

  it("offers Feishu and WeCom without Telegram", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const Panel = customElements.get("chat-settings-panel");
    const panel = new Panel();
    document.body.appendChild(panel);
    await flushPromises();

    expect(panel.textContent).toContain("飞书");
    expect(panel.textContent).toContain("企业微信");
    expect(panel.textContent).not.toContain("Telegram");
    expect(panel.querySelector('[data-service="feishu"]')).not.toBeNull();
    expect(panel.querySelector('[data-service="wecom"]')).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("waits for the config gateway and clears stale load errors after recovery", async () => {
    const Panel = customElements.get("chat-settings-panel");
    const panel = new Panel();
    document.body.appendChild(panel);

    window.__picotConfigCall = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "temporarily disconnected" })
      .mockResolvedValueOnce({
        ok: true,
        data: { content: '{"botName":"ZiCode","accounts":{}}' },
      });

    window.dispatchEvent(new CustomEvent("picot-config-gateway-ready"));
    await flushPromises();
    expect(panel.querySelector("[data-status]").textContent).toContain("temporarily disconnected");

    window.dispatchEvent(new CustomEvent("picot-config-gateway-ready"));
    await flushPromises();
    expect(panel.querySelector("[data-status]").classList.contains("hidden")).toBe(true);
    expect(panel.querySelector("[data-textarea]").value).toContain('"botName":"ZiCode"');
  });

  it("localizes a closed Pi runtime in the load status", async () => {
    const Panel = customElements.get("chat-settings-panel");
    const panel = new Panel();
    document.body.appendChild(panel);

    window.__picotConfigCall = vi.fn().mockResolvedValue({
      ok: false,
      error: "Pi RPC request failed: ProcessClosed",
    });

    window.dispatchEvent(new CustomEvent("picot-config-gateway-ready"));
    await flushPromises();
    expect(panel.querySelector("[data-status]").textContent).toContain(
      "Pi 运行时连接已断开。请重试或新建一个会话。",
    );
  });
});
