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
async function mount(activeTool: ManualTool = tool, resourceInputProfile?: string, inputSchema: unknown = { type: "object", properties: { text: { type: "string" } } }, onOpenApplication?: () => void) {
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
    scope={{ sceneId: "programming", workspaceId: "workspace" }} accessStore={store} onOpenApplication={onOpenApplication} />));
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

it("keeps tool information and the alternate application route in a collapsed disclosure", async () => {
  const open = vi.fn();
  const { container } = await mount({ ...tool, description: "Tool explanation" }, undefined, undefined, open);
  const info = container.querySelector("details.tool-information") as HTMLDetailsElement;
  expect(info).toBeTruthy(); expect(info.open).toBe(false);
  expect(info.textContent).toContain("Fixture"); expect(info.textContent).toContain("Tool explanation");
  const application = [...container.querySelectorAll("button")].find(button => button.textContent === "打开工具界面");
  expect(application?.closest("details")).toBe(info);
  await act(async () => application?.click()); expect(open).toHaveBeenCalledTimes(1);
});

it("keeps result navigation beside Run instead of inserting it before the input", async () => {
  const { container, submit } = await mount();
  expect(container.textContent).not.toContain("切换页面后工具继续运行");
  await submit();
  const form = container.querySelector("form") as HTMLFormElement;
  const button = [...form.querySelectorAll("button")].find(node => node.textContent === "查看最近执行结果");
  expect(button?.parentElement).toBe(form.querySelector('button[type="submit"]')?.parentElement);
  expect((form.querySelector("textarea")?.compareDocumentPosition(button as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.textContent).not.toContain("切换页面后工具继续运行");
});

it("shows the background-running warning only while the issued call is pending", async () => {
  const { container, api, submit } = await mount();
  let finish!: (value: { result: ReturnType<typeof envelope> }) => void;
  vi.mocked(api.invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await submit();
  expect(container.textContent).toContain("切换页面后工具继续运行");
  expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  await act(async () => finish({ result: envelope("done") }));
  expect(container.textContent).not.toContain("切换页面后工具继续运行");
});

it("keeps the interface as the single primary action when the tool needs its own UI", async () => {
  const open = vi.fn();
  const { container, api } = await mount({ ...tool, runtime: "builtin" }, undefined, undefined, open);
  const button = [...container.querySelectorAll("button")].find(node => node.textContent === "打开工具界面");
  expect(button).toBeTruthy(); expect(button?.closest("details")).toBeNull();
  expect(button?.classList.contains("ui-button--primary")).toBe(true);
  expect(container.querySelector("form")).toBeNull();
  await act(async () => button?.click());
  expect(open).toHaveBeenCalledTimes(1); expect(api.invoke).not.toHaveBeenCalled();
});
