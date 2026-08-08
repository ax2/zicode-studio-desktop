import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setLocale } from "../../shared/i18n.js";
import { ProjectMain, ProjectNav } from "./ProjectWorkspaceApp";
import { createProjectWorkspaceStore } from "./store";

function renderStore(options: Record<string, unknown> = {}) {
  const store = createProjectWorkspaceStore({
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
    getTarget: () => ({
      cwd: "C:/work/zicode",
      workspaceId: "workspace-1",
      sceneId: "programming",
    }),
    storage: localStorage,
    ...options,
  });
  render(
    <div>
      <ProjectNav store={store} />
      <ProjectMain store={store} />
    </div>,
  );
  void store.getState().load();
  return store;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  setLocale("zh-CN");
});

describe("project workspace React app", () => {
  it("aggregates notes and artifacts for the current project", async () => {
    setLocale("en");
    const store = renderStore();
    await waitFor(() => expect(screen.getByText("Report")).toBeTruthy());
    expect(screen.getByText("Decision")).toBeTruthy();
    expect(document.querySelectorAll(".project-workspace-stat strong")[1].textContent).toBe("1");
    store.getState().setTarget(null);
  });

  it("opens a recent project result in its app from the overview", async () => {
    setLocale("en");
    const store = renderStore();
    await waitFor(() => expect(screen.getByText("Decision")).toBeTruthy());
    const dispatched: string[] = [];
    const listener = (event: Event) => dispatched.push(event.type);
    window.addEventListener("zicode:open-note", listener);
    (document.querySelector(".project-workspace-results .project-workspace-result-row") as HTMLButtonElement).click();
    window.removeEventListener("zicode:open-note", listener);
    expect(dispatched).toEqual(["zicode:open-note"]);
    store.getState().setTarget(null);
  });

  it("persists project context independently by workspace", async () => {
    setLocale("en");
    const store = renderStore();
    await waitFor(() => expect(screen.getByText("Report")).toBeTruthy());
    (
      document.querySelectorAll(".project-workspace-nav-item")[1] as HTMLButtonElement
    ).click();
    await waitFor(() =>
      expect(document.querySelector("textarea")).toBeTruthy(),
    );
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Use strict local verification" } });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(localStorage.getItem("zicode.project-workspaces.v1")).toContain(
      "Use strict local verification",
    );
    store.getState().setTarget(null);
  });

  it("uses the project-authoritative configuration plane when available", async () => {
    setLocale("en");
    const call = vi.fn(async (operation: string, params?: unknown) => {
      if (operation === "read_project_profile") {
        return {
          ok: true,
          data: {
            profile: { instructions: "Shared context", defaultScene: "finance", budget: 8 },
          },
        };
      }
      if (operation === "write_project_profile") {
        return { ok: true, data: { profile: (params as { profile?: unknown }).profile } };
      }
      return { ok: false };
    });
    const store = renderStore({ call });
    await waitFor(() => expect(call).toHaveBeenCalledWith("read_project_profile"));
    (
      document.querySelectorAll(".project-workspace-nav-item")[1] as HTMLButtonElement
    ).click();
    await waitFor(() =>
      expect(document.querySelector("textarea")).toBeTruthy(),
    );
    expect((document.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "Shared context",
    );
    fireEvent.change(document.querySelector("textarea") as HTMLTextAreaElement, {
      target: { value: "Updated shared context" },
    });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "write_project_profile",
        expect.objectContaining({
          profile: expect.objectContaining({ instructions: "Updated shared context" }),
        }),
      ),
    );
    expect(localStorage.getItem("zicode.project-workspaces.v1")).toBeNull();
    store.getState().setTarget(null);
  });

  it("aggregates sessions and files into project search", async () => {
    setLocale("en");
    const dataGateway = {
      listSessions: vi.fn(async () => ({ sessions: [{ id: "session-1", title: "Release plan" }] })),
      listFiles: vi.fn(async () => ({
        files: [{ name: "roadmap.md", path: "docs/roadmap.md" }],
      })),
      searchSessions: vi.fn(async () => ({
        results: [{ sessionId: "session-1", title: "Release plan", snippet: "M6" }],
      })),
    };
    const store = renderStore({ dataGateway });
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".project-workspace-stat strong")].map(
          (item) => item.textContent,
        ),
      ).toContain("1"),
    );
    (
      document.querySelectorAll(".project-workspace-nav-item")[3] as HTMLButtonElement
    ).click();
    await waitFor(() =>
      expect(document.querySelector(".project-workspace-search-form")).toBeTruthy(),
    );
    const query = document.querySelector(
      '.project-workspace-search-form input[type="search"]',
    ) as HTMLInputElement;
    const queryLabel = document.querySelector(".project-workspace-search-field");
    expect(queryLabel?.textContent).toContain("Project search");
    fireEvent.change(query, { target: { value: "roadmap" } });
    fireEvent.submit(
      document.querySelector(".project-workspace-search-form") as HTMLFormElement,
    );
    await waitFor(() => expect(screen.getByText("roadmap.md")).toBeTruthy());
    expect(dataGateway.searchSessions.mock.calls).toEqual([
      ["workspace-1", "roadmap"],
    ]);
    store.getState().setTarget(null);
  });

  it("shows task and automation counts and opens results in their apps", async () => {
    setLocale("en");
    const call = vi.fn(async (operation: string) => {
      if (operation === "read_super_agent_tasks") {
        return { ok: true, data: { tasks: [{ id: "t1" }, { id: "t2" }, { id: "t3" }] } };
      }
      if (operation === "automation_workspace") {
        return { ok: true, data: { workflows: [{ id: "a1" }, { id: "a2" }] } };
      }
      return { ok: false };
    });
    const store = renderStore({ call });
    await waitFor(() =>
      expect(
        [...document.querySelectorAll(".project-workspace-stat strong")].map(
          (item) => item.textContent,
        ),
      ).toEqual(["1", "1", "1", "0", "0", "3", "2"]),
    );
    const dispatched: string[] = [];
    const listener = (event: Event) =>
      dispatched.push(`${event.type}:${JSON.stringify((event as CustomEvent).detail ?? {})}`);
    window.addEventListener("zicode:open-note", listener);
    store.getState().openResult({ kind: "Note", notebookId: "book-1", id: "note-1" });
    window.removeEventListener("zicode:open-note", listener);
    expect(dispatched).toEqual([
      'zicode:open-note:{"notebookId":"book-1","noteId":"note-1"}',
    ]);
    store.getState().setTarget(null);
  });
});
