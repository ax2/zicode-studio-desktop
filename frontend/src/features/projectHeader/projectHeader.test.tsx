import { afterEach, describe, expect, it, vi } from "vitest";
import { setupProjectHeader } from "./index";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("project header (React)", () => {
  it("shows the full workspace path and git branch in header pills", async () => {
    document.body.innerHTML =
      '<div id="workspace-indicator" class="hidden"></div><span id="git-branch-indicator" class="hidden"></span>';
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({
        info: { path: "/Users/ShixinGuo/code/pi", gitBranch: "main" },
      }),
    };

    await setupProjectHeader({ data, workspaceId: "workspace-a" });

    const indicator = document.getElementById("workspace-indicator");
    const branch = document.getElementById("git-branch-indicator");
    expect(data.workspaceInfo).toHaveBeenCalledWith("workspace-a");
    expect(indicator?.textContent).toBe("/Users/ShixinGuo/code/pi");
    expect(indicator?.title).toBe("/Users/ShixinGuo/code/pi");
    expect(indicator?.classList.contains("hidden")).toBe(false);
    expect(branch?.textContent).toBe("main");
    expect(branch?.classList.contains("hidden")).toBe(false);
  });
});
