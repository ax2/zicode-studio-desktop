import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ResourceToolRunner } from "./ResourceToolRunner";
import type { ManualTool, ManualToolApi, ToolDetail } from "./manual-tools";
const mock = vi.hoisted(() => ({ mount: vi.fn(() => ({ destroy: vi.fn() })) }));
vi.mock("../../../../public/native/plugins/directory-resource-runner.js", () => ({ createDirectoryResourceRunner: mock.mount }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); mock.mount.mockClear(); document.body.replaceChildren(); });
it("retains a running resource surface across equivalent scope/callback updates and resets for a different session", async () => {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  let target = { sceneId: "programming", workspaceId: "ws", instanceId: "runtime", sessionId: "one" };
  const getTarget = () => target, api = {} as ManualToolApi;
  const tool = { accessId: "access" } as ManualTool, detail = {} as ToolDetail;
  const render = () => root.render(<ResourceToolRunner tool={tool} detail={detail} api={api} getTarget={getTarget}
    scope={{ sceneId: "programming", workspaceId: "ws" }} onBusy={() => {}} onRecentChange={() => {}} />);
  await act(async () => render()); const first = mock.mount.mock.results[0].value;
  await act(async () => render()); expect(mock.mount).toHaveBeenCalledTimes(1); expect(first.destroy).not.toHaveBeenCalled();
  target = { ...target, sessionId: "two" };
  await act(async () => render()); expect(first.destroy).toHaveBeenCalledOnce(); expect(mock.mount).toHaveBeenCalledTimes(2);
});
