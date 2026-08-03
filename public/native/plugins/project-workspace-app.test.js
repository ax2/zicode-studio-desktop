import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { setupProjectWorkspaceApp } from "./project-workspace-app.js";

function render(options = {}) {
  document.body.innerHTML = '<aside id="nav"></aside><main id="content"></main>';
  const app = setupProjectWorkspaceApp({
    notesGateway: {
      list: vi.fn(async () => ({
        snapshot: {
          notebooks: [{ id: "book", title: "Product", noteCount: 1 }],
          notes: [{ id: "note", title: "Decision", updatedAt: "2026-07-31T10:00:00Z" }],
        },
      })),
    },
    artifactGateway: {
      list: vi.fn(async () => ({
        snapshot: {
          artifacts: [{ id: "artifact", title: "Report", createdAt: "2026-07-31T11:00:00Z" }],
        },
      })),
    },
    getTarget: () => ({ cwd: "C:/work/zicode", workspaceId: "workspace-1", sceneId: "programming" }),
    storage: localStorage,
    ...options,
  });
  app.renderNavigation(document.getElementById("nav"));
  app.renderContent(document.getElementById("content"));
  return app;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  setLocale("zh-CN");
});

describe("project workspace app", () => {
  it("aggregates notes and artifacts for the current project", async () => {
    render();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Report"));
    expect(document.body.textContent).toContain("Decision");
    expect(document.querySelectorAll(".project-workspace-stat strong")[1].textContent).toBe("1");
  });

  it("persists project context independently by workspace", async () => {
    render();
    document.querySelectorAll(".project-workspace-nav-item")[1].click();
    const textarea = document.querySelector("textarea");
    textarea.value = "Use strict local verification";
    document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(localStorage.getItem("zicode.project-workspaces.v1")).toContain("Use strict local verification");
  });

  it("uses the project-authoritative configuration plane when available", async () => {
    const call = vi.fn(async (operation, params) => {
      if (operation === "read_project_profile") {
        return {
          ok: true,
          data: { profile: { instructions: "Shared context", defaultScene: "finance", budget: 8 } },
        };
      }
      if (operation === "write_project_profile") return { ok: true, data: { profile: params.profile } };
      return { ok: false };
    });
    render({ call });
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith("read_project_profile"));
    document.querySelectorAll(".project-workspace-nav-item")[1].click();
    expect(document.querySelector("textarea").value).toBe("Shared context");
    document.querySelector("textarea").value = "Updated shared context";
    document.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "write_project_profile",
        expect.objectContaining({ profile: expect.objectContaining({ instructions: "Updated shared context" }) }),
      ),
    );
    expect(localStorage.getItem("zicode.project-workspaces.v1")).toBeNull();
  });

  it("aggregates sessions and files into project search", async () => {
    const dataGateway = {
      listSessions: vi.fn(async () => ({ sessions: [{ id: "session-1", title: "Release plan" }] })),
      listFiles: vi.fn(async () => ({ files: [{ name: "roadmap.md", path: "docs/roadmap.md" }] })),
      searchSessions: vi.fn(async () => ({ results: [{ sessionId: "session-1", title: "Release plan", snippet: "M6" }] })),
    };
    render({ dataGateway });
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll(".project-workspace-stat strong")].map((item) => item.textContent),
      ).toContain("1"),
    );
    document.querySelectorAll(".project-workspace-nav-item")[3].click();
    const query = document.querySelector('.project-workspace-search-form input[type="search"]');
    const queryLabel = document.querySelector(".project-workspace-search-field");
    expect(queryLabel.textContent).toContain("项目搜索");
    expect(query.labels).toHaveLength(1);
    expect(query.labels[0]).toBe(queryLabel);
    query.value = "roadmap";
    document.querySelector(".project-workspace-search-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(document.body.textContent).toContain("roadmap.md"));
    expect(dataGateway.searchSessions).toHaveBeenCalledWith("workspace-1", "roadmap");
  });
});
