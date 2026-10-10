import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { GitStatusPanel } from "./GitStatusPanel";
import type { GitStatus } from "./git-status";
import { createProjectWorkspaceStore } from "./store";

const clean: GitStatus = {
  isRepository: true,
  branch: "main",
  upstream: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicts: 0,
  totalFiles: 0,
  truncated: false,
  files: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

describe("project Git status", () => {
  it("renders branch tracking, rename paths and counts in Chinese", async () => {
    setLocale("zh-CN");
    const readStatus = vi.fn(async () => ({
      ...clean,
      upstream: "origin/main",
      ahead: 2,
      behind: 1,
      staged: 1,
      unstaged: 1,
      totalFiles: 1,
      files: [
        {
          path: "中文 new.txt",
          originalPath: "old name.txt",
          indexStatus: "R",
          worktreeStatus: "M",
        },
      ],
    }));
    render(<GitStatusPanel workspaceId="a" revision={1} readStatus={readStatus} />);
    await screen.findByText("old name.txt → 中文 new.txt");
    expect(screen.getByText("origin/main · 领先 2 · 落后 1")).toBeTruthy();
    expect(screen.getByText("暂存区: 已重命名 · 工作树: 已修改")).toBeTruthy();
    expect(readStatus).toHaveBeenCalledWith("a");
  });

  it("hides stale results immediately and ignores late responses after switching projects", async () => {
    setLocale("en");
    const a = deferred<GitStatus>();
    const b = deferred<GitStatus>();
    const readStatus = vi.fn((id: string) => (id === "a" ? a.promise : b.promise));
    const view = render(<GitStatusPanel workspaceId="a" revision={1} readStatus={readStatus} />);
    view.rerender(<GitStatusPanel workspaceId="b" revision={2} readStatus={readStatus} />);
    await act(async () => b.resolve({ ...clean, branch: "project-b" }));
    await act(async () => a.resolve({ ...clean, branch: "project-a" }));
    expect(screen.getByText("project-b")).toBeTruthy();
    expect(screen.queryByText("project-a")).toBeNull();
    view.rerender(<GitStatusPanel workspaceId={null} revision={3} readStatus={readStatus} />);
    expect(screen.queryByText("project-b")).toBeNull();
    expect(screen.getByText("Open a project folder to inspect Git changes.")).toBeTruthy();
  });

  it("reports failure without a clean claim and refreshes independently", async () => {
    setLocale("en");
    const readStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("git_timeout"))
      .mockResolvedValueOnce({ ...clean, isRepository: false })
      .mockResolvedValue(clean);
    const view = render(<GitStatusPanel workspaceId="a" revision={1} readStatus={readStatus} />);
    await screen.findByText("Git inspection timed out. Try refreshing this project.");
    expect(screen.queryByText("No changes in this project folder.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Git status" }));
    await screen.findByText("This project is not a Git working tree.");
    view.rerender(<GitStatusPanel workspaceId="a" revision={2} readStatus={readStatus} />);
    await screen.findByText("No changes in this project folder.");
    expect(readStatus).toHaveBeenCalledTimes(3);
  });

  it("shows detached HEAD and truncated-list limitations", async () => {
    setLocale("en");
    render(
      <GitStatusPanel
        workspaceId="a"
        revision={1}
        readStatus={async () => ({
          ...clean,
          branch: "(detached)",
          untracked: 201,
          totalFiles: 201,
          truncated: true,
          files: [
            { path: "<script>\nname", originalPath: null, indexStatus: "?", worktreeStatus: "?" },
          ],
        })}
      />,
    );
    await screen.findByText("Detached HEAD");
    expect(
      screen.getByText(
        "Showing the first 200 changed entries. Counts include all reported entries.",
      ),
    ).toBeTruthy();
    expect(document.querySelector(".project-git script")).toBeNull();
  });
});

describe("project request isolation", () => {
  it("loads the new target while the old load is pending and drops old profiles, drafts and results", async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    const profileA = deferred<{ ok: boolean; data: unknown }>();
    let profileCalls = 0;
    const list = vi.fn((_scene: string, id: string) => (id === "a" ? a.promise : b.promise));
    const store = createProjectWorkspaceStore({
      getTarget: () => ({ workspaceId: "a" }),
      notesGateway: { list },
      call: async (operation) =>
        operation === "read_project_profile"
          ? ++profileCalls === 1
            ? profileA.promise
            : {
                ok: true,
                data: { profile: { instructions: "B", defaultScene: "programming", budget: "" } },
              }
          : { ok: true, data: {} },
    });
    const first = store.getState().load();
    store.getState().setContextDraft({ instructions: "unsaved A" });
    store.getState().setTarget({ workspaceId: "b" });
    expect(list).toHaveBeenLastCalledWith("programming", "b");
    b.resolve({ snapshot: { notes: [{ id: "b", title: "B note" }] } });
    await waitFor(() => expect(store.getState().loading).toBe(false));
    a.resolve({ snapshot: { notes: [{ id: "a", title: "A note" }] } });
    profileA.resolve({ ok: true, data: { profile: { instructions: "A" } } });
    await first;
    expect(store.getState().snapshot.notes[0].title).toBe("B note");
    expect(store.getState().profile.instructions).toBe("B");
    expect(store.getState().contextDraft).toBeNull();
  });

  it("does not restore an earlier search after a newer query or target switch", async () => {
    const old = deferred<unknown>();
    const store = createProjectWorkspaceStore({
      getTarget: () => ({ workspaceId: "a" }),
      dataGateway: {
        searchSessions: vi
          .fn()
          .mockReturnValueOnce(old.promise)
          .mockResolvedValue({ results: [{ title: "new" }] }),
      },
    });
    const first = store.getState().runProjectSearch("old");
    await store.getState().runProjectSearch("new");
    store.getState().setTarget({ workspaceId: "b" });
    old.resolve({ results: [{ title: "old" }] });
    await first;
    expect(store.getState().sessionSearchResults).toEqual([]);
    expect(store.getState().searchQuery).toBe("");
  });
});
