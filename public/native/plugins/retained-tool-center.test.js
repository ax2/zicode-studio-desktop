import { expect, it, vi } from "vitest";
import { createRetainedToolCenter } from "./retained-tool-center.js";

it("retains one surface across navigation and destroys it on scope change or shell teardown", () => {
  const first = { update: vi.fn(), destroy: vi.fn(), openTool: vi.fn() };
  const second = { update: vi.fn(), destroy: vi.fn(), openTool: vi.fn() };
  const mount = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const view = createRetainedToolCenter(mount);
  const container = document.createElement("div");
  const props = { scope: { sceneId: "programming", workspaceId: "workspace-a" } };
  view.show(container, props); const surface = container.firstChild;
  container.replaceChildren(); view.show(container, props);
  expect(container.firstChild).toBe(surface); expect(mount).toHaveBeenCalledTimes(1);
  expect(first.update).toHaveBeenCalledWith(props); expect(first.destroy).not.toHaveBeenCalled();
  view.openTool("tool", "revision"); expect(first.openTool).toHaveBeenCalledWith("tool", "revision");
  view.setScope({ ...props.scope, workspaceId: "workspace-b" }); expect(first.destroy).toHaveBeenCalledTimes(1);
  view.show(container, { scope: { ...props.scope, workspaceId: "workspace-b" } });
  expect(mount).toHaveBeenCalledTimes(2); view.destroy(); expect(second.destroy).toHaveBeenCalledTimes(1);
});
