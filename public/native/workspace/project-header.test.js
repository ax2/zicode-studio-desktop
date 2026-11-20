import { afterEach, describe, expect, it, vi } from "vitest";
import { setupProjectHeader } from "../react/project-header.js";

describe("project header", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps workspace paths out of text, title and the visible header", async () => {
    document.body.innerHTML = '<div id="workspace-indicator" class="hidden"></div>';
    const fullPath = "/Users/ShixinGuo/code/pi/pi-web-ui";
    const data = {
      workspaceInfo: vi.fn().mockResolvedValue({ info: { path: fullPath } }),
    };

    await setupProjectHeader({ data, workspaceId: "workspace-a" });

    const indicator = document.getElementById("workspace-indicator");
    expect(data.workspaceInfo).toHaveBeenCalledWith("workspace-a");
    expect(indicator.textContent).toBe("");
    expect(indicator.title).toBe("");
    expect(indicator.classList.contains("hidden")).toBe(true);
  });
});
