import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { emptyAccess } from "../commandPalette/tool-access";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); });
const tool: ManualTool = { toolId: "tool", accessId: "access", pluginId: "fixture", capabilityId: "decode", title: "Decode",
  applicationName: "Fixture", publisher: "Studio", version: "0.1.0", enabled: true, runtime: "wasi" };
const envelope = (text: string) => ({ contractVersion: "1.0.0-rc.1", ok: true, data: { text }, error: null });
async function mount(activeTool: ManualTool = tool, resourceInputProfile?: string, inputSchema: unknown = { type: "object", properties: { text: { type: "string" } } }) {
  setLocale("zh-CN");
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({ pluginId: activeTool.pluginId, version: "0.1.0", revision: "revision", enabled: activeTool.enabled,
      resourceInputProfile, capability: { id: activeTool.capabilityId, inputSchema },
      permissions: resourceInputProfile ? [{ name: "resource.read", granted: true, required: false, reason: "" }] : [] })),
    invoke: vi.fn(async () => ({ result: envelope("中\nnext\n") })),
  };
  const store = { read: vi.fn(async () => emptyAccess()), mutate: vi.fn(async () => emptyAccess()) };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ManualToolDetail tool={activeTool} revision="revision" api={api}
    scope={{ sceneId: "programming", workspaceId: "workspace" }} accessStore={store} />));
  const submit = async () => { await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); };
  return { container, api, store, submit };
}

it("keeps object input editable for a disabled plugin and explains the actual blocker", async () => {
  const disabled = await mount({ ...tool, enabled: false }, undefined,
    { type: "object", properties: { value: { type: "object", maxProperties: 128 } }, required: ["value"], additionalProperties: false });
  expect(disabled.container.querySelector("form textarea")).toBeTruthy();
  expect(disabled.container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  expect(disabled.container.textContent).toContain("请先在插件管理中启用此插件");
  expect(disabled.container.textContent).not.toContain("通用表单无法执行");
});

it("routes only fixed built-in resource receivers to the trusted resource UI", async () => {
  const receiver = { ...tool, runtime: "builtin" as const, pluginId: "com.zicode.ocr", capabilityId: "ocr.resource-text" };
  const allowed = await mount(receiver, "resource.host.ocr-input.v1");
  expect(allowed.container.querySelector(".directory-resource-tool")).toBeTruthy();
  expect(allowed.container.textContent).not.toContain("通用表单无法执行");
  const unsupported = await mount({ ...receiver, pluginId: "other" }, "resource.host.ocr-input.v1");
  expect(unsupported.container.querySelector(".directory-resource-tool")).toBeNull();
  expect(unsupported.container.textContent).toContain("通用表单无法执行");
});

it("shows exact readable text, collapsed original response and records successful use", async () => {
  const { container, store, submit } = await mount(); await submit();
  expect((container.querySelector("[data-tool-result]") as HTMLTextAreaElement).value).toBe("中\nnext\n");
  expect(container.textContent).toContain("工具执行成功");
  expect(container.querySelector("details")?.open).toBe(false);
  expect(store.mutate).toHaveBeenCalledWith({ sceneId: "programming", workspaceId: "workspace" }, { kind: "recentRecord", id: "access" });
});

it("replaces prior success with an escaped business error and does not record failed use", async () => {
  const { container, api, store, submit } = await mount(); await submit(); store.mutate.mockClear();
  vi.mocked(api.invoke).mockResolvedValue({ result: { contractVersion: "1.0.0-rc.1", ok: false, data: null,
    error: { code: "INVALID_ENCODING", message: "<script>not HTML</script>" } } });
  await submit();
  expect(container.querySelector("[data-tool-result]")).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("INVALID_ENCODING");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("<script>not HTML</script>");
  expect(container.querySelector("script")).toBeNull(); expect(store.mutate).not.toHaveBeenCalled();
  vi.mocked(api.invoke).mockResolvedValue({ result: envelope("recovered") }); await submit();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect((container.querySelector("[data-tool-result]") as HTMLTextAreaElement).value).toBe("recovered");
  expect(store.mutate).toHaveBeenCalledTimes(1);
});

it("clears stale output on Host failure and preserves success when history cannot save", async () => {
  const { container, api, store, submit } = await mount(); await submit(); store.mutate.mockClear();
  vi.mocked(api.invoke).mockRejectedValue({ code: "worker_timeout" }); await submit();
  expect(container.querySelector("[data-tool-result]")).toBeNull(); expect(store.mutate).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("超时");
  vi.mocked(api.invoke).mockResolvedValue({ result: envelope("success") });
  store.mutate.mockRejectedValue(new Error("history unavailable")); await submit();
  expect((container.querySelector("[data-tool-result]") as HTMLTextAreaElement).value).toBe("success");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("未能保存使用记录");
});
