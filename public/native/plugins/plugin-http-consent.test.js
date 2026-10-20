import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { showNativeDialog } from "../react/dialog.js";
import { confirmPluginHttpGet } from "./plugin-http-consent.js";

describe("plugin HTTP consent", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="dialog-container" class="hidden"></div>';
    setLocale("zh-CN");
  });

  it("shows the exact Host target and warns for plaintext local requests", async () => {
    const preview = { grantId: "secret-grant", operationId: "operation", expiresInMs: 30_000,
      display: { origin: "http://127.0.0.1:8080", path: "/actuator/health", endpoint: "health",
        addressClass: "loopback", https: false, maxResponseBytes: 1_048_576, timeoutMs: 8_000 } };
    const showDialog = vi.fn(async () => ({ confirmed: true }));
    expect(await confirmPluginHttpGet(preview, "Actuator", showDialog)).toBe(true);
    const [options] = showDialog.mock.calls[0];
    expect(options.method).toBe("confirm");
    expect(options.title).toContain("http://127.0.0.1:8080");
    expect(options.title).toContain("GET /actuator/health");
    expect(options.title).toContain("此本地 HTTP 请求未加密。");
    expect(options.title).not.toContain("secret-grant");
  });

  it("refuses incomplete or altered consent metadata", async () => {
    const showDialog = vi.fn(async () => ({ confirmed: true }));
    expect(await confirmPluginHttpGet({ display: { origin: "http://localhost" } }, "Plugin", showDialog)).toBe(false);
    expect(showDialog).not.toHaveBeenCalled();
  });

  it("explains that hostname DNS resolution happens only after consent", async () => {
    const preview = { grantId: "secret-grant", operationId: "operation", expiresInMs: 30_000,
      display: { origin: "https://metrics.example.test", path: "/actuator/metrics", endpoint: "metrics",
        addressClass: "hostname", https: true, maxResponseBytes: 1_048_576, timeoutMs: 8_000 } };
    const showDialog = vi.fn(async () => ({ confirmed: true }));
    expect(await confirmPluginHttpGet(preview, "Actuator", showDialog)).toBe(true);
    expect(showDialog.mock.calls[0][0].title).toContain("批准后才解析此域名");
    expect(showDialog.mock.calls[0][0].title).toContain("私网或回环地址会被拒绝");
    expect(showDialog.mock.calls[0][0].title).not.toContain("secret-grant");
  });

  it("passes a cancellation signal to the trusted confirmation dialog", async () => {
    const preview = { grantId: "secret-grant", operationId: "operation", expiresInMs: 30_000,
      display: { origin: "http://127.0.0.1:8080", path: "/actuator/health", endpoint: "health",
        addressClass: "loopback", https: false, maxResponseBytes: 1_048_576, timeoutMs: 8_000 } };
    const dismissSignal = Promise.resolve();
    const showDialog = vi.fn(async (_request, _container, options) => {
      await options.dismissSignal;
      return { cancelled: true };
    });
    expect(await confirmPluginHttpGet(preview, "Actuator", showDialog, undefined, dismissSignal)).toBe(false);
    expect(showDialog.mock.calls[0][2]).toEqual({ dismissSignal });
  });

  it("closes the real confirmation component when the HTTP operation is cancelled", async () => {
    const preview = { grantId: "secret-grant", operationId: "operation", expiresInMs: 30_000,
      display: { origin: "http://127.0.0.1:8080", path: "/actuator/health", endpoint: "health",
        addressClass: "loopback", https: false, maxResponseBytes: 1_048_576, timeoutMs: 8_000 } };
    let dismiss;
    const dismissSignal = new Promise((resolve) => { dismiss = resolve; });
    const container = document.getElementById("dialog-container");
    const result = confirmPluginHttpGet(preview, "Actuator", showNativeDialog,
      container, dismissSignal);
    expect(container.classList.contains("hidden")).toBe(false);
    expect(container.querySelector(".dialog-message")?.textContent).toContain("127.0.0.1");
    dismiss();
    await expect(result).resolves.toBe(false);
    expect(container.classList.contains("hidden")).toBe(true);
  });
});
