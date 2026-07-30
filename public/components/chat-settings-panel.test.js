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
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ content: '{"botName":"ZiCode","accounts":{}}' }),
    });
    const Panel = customElements.get("chat-settings-panel");
    const panel = new Panel();
    document.body.appendChild(panel);
    await flushPromises();

    expect(panel.textContent).toContain("飞书");
    expect(panel.textContent).toContain("企业微信");
    expect(panel.textContent).not.toContain("Telegram");
    expect(panel.querySelector('[data-service="feishu"]')).not.toBeNull();
    expect(panel.querySelector('[data-service="wecom"]')).not.toBeNull();
  });
});
