import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolSession } from "./ManualToolSession";
import type { ManualToolApi, ToolDetail } from "./manual-tools";

const factory = vi.hoisted(() => ({ creates: vi.fn(), destroys: vi.fn(), cancels: vi.fn() }));
vi.mock("../../../../public/native/plugins/directory-resource-runner.js", () => ({
  createDirectoryResourceRunner: ({ container, onBusy }: { container: HTMLDivElement; onBusy(busy: boolean): void }) => {
    const run = document.createElement("button"), cancel = document.createElement("button"), result = document.createElement("p");
    run.textContent = "Resource execute"; run.onclick = () => onBusy(true);
    cancel.textContent = "Resource cancel"; cancel.onclick = () => { factory.cancels(); result.textContent = "resource cancelled"; onBusy(false); };
    container.append(run, cancel, result); factory.creates();
    return { destroy() { factory.destroys(); container.replaceChildren(); } };
  },
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("retains a resource controller, cancel button and busy protection across a real React detail failure", async () => {
  setLocale("en");
  const detail: ToolDetail = { resourceInputProfile: "resource.wasi.input.draft2", pluginId: "resource", version: "1", revision: "r", enabled: true,
    capability: { id: "run", inputSchema: { type: "object", properties: {} } }, permissions: [] };
  const api = { searchTools: vi.fn(), loadTool: vi.fn(async () => detail), invoke: vi.fn() } satisfies ManualToolApi;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root); const busy = vi.fn();
  const tool = { toolId: "resource/run", accessId: "resource:run", pluginId: "resource", capabilityId: "run", title: "Resource",
    applicationName: "Studio", publisher: "Studio", version: "1", enabled: true, runtime: "wasi" };
  const render = () => root.render(<ManualToolSession tool={tool} revision="r" api={api} scope={{ sceneId: "programming", workspaceId: "workspace" }}
    onDirectory={() => {}} onBusy={busy} />);
  await act(async () => render());
  const run = [...container.querySelectorAll("button")].find(button => button.textContent === "Resource execute");
  expect(run).toBeTruthy(); await act(async () => run?.click()); expect(busy).toHaveBeenLastCalledWith(true);
  vi.spyOn(console, "error").mockImplementation(() => {}); detail.permissions = null as unknown as ToolDetail["permissions"];
  await act(async () => render()); await act(async () => { await Promise.resolve(); });
  const fallback = container.querySelector('[role="alert"]'); expect(fallback?.textContent).toContain("Tool view unavailable");
  expect(fallback?.contains(run ?? null)).toBe(true); expect(factory.creates).toHaveBeenCalledTimes(1); expect(factory.destroys).not.toHaveBeenCalled();
  expect(busy).toHaveBeenLastCalledWith(true);
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  const cancel = [...container.querySelectorAll("button")].find(button => button.textContent === "Resource cancel");
  await act(async () => cancel?.click()); expect(factory.cancels).toHaveBeenCalledTimes(1);
  expect(fallback?.textContent).toContain("resource cancelled"); expect(busy).toHaveBeenLastCalledWith(false);
  roots.splice(roots.indexOf(root), 1); await act(async () => root.unmount()); expect(factory.destroys).toHaveBeenCalledTimes(1);
  expect(api.invoke).not.toHaveBeenCalled();
});
