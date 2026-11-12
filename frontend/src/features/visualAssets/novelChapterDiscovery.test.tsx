import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NovelChapterDiscovery } from "./NovelChapterDiscovery";
import { NovelDraftPanel } from "./NovelDraftPanel";
import type { CharacterRequest } from "./useCharacterRecords";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps the unsaved discovered chapter draft when the manuscript panel is collapsed", async () => {
  const chapter = {
    id: "chapter",
    title: "桥头",
    revision: "current",
    status: "new",
    draftId: null,
  };
  const request = vi.fn<CharacterRequest>(async (action) => {
    if (action.kind === "list") return { entries: [], next: null };
    if (action.kind === "notebooks") return { notebooks: [{ id: "book", title: "小说" }] };
    if (action.kind === "discover") return { entries: [chapter], next: null };
    if (action.kind === "preview")
      return {
        baseVersion: 1,
        excerpts: [
          {
            notebookId: "book",
            chapterId: "chapter",
            chapterTitle: "桥头",
            revision: "current",
            line: 1,
            quote: "绘光守桥。",
          },
        ],
      };
    throw new Error("Unexpected mutation");
  });
  render(
    <NovelDraftPanel
      characterId="role"
      characterName="绘光"
      request={request}
      disabled={false}
      onApproved={() => {}}
    />,
  );
  const toggle = screen.getByRole("button", { name: "Manuscript character drafts" });
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Discover chapter updates" }));
  fireEvent.click(await screen.findByRole("button", { name: "Refresh chapter discovery" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Prepare draft from current chapter" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Find chapter excerpts" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use this excerpt" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Proposed character text" }), {
    target: { value: "尚未保存的设定" },
  });
  const calls = request.mock.calls.length;
  fireEvent.click(toggle);
  expect(screen.queryByRole("textbox", { name: "Proposed character text" })).toBeNull();
  fireEvent.click(toggle);
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Proposed character text" }).value,
  ).toBe("尚未保存的设定");
  expect(request).toHaveBeenCalledTimes(calls);
});

it("continues through empty filtered pages, retries a failed page, and pins a discovered chapter", async () => {
  const chapter = {
    id: "new",
    title: "新章节",
    revision: "sha256:new",
    status: "new",
    draftId: null,
  };
  const evidence = {
    workspaceId: "workspace",
    notebookId: "book",
    chapterId: "new",
    chapterTitle: "新章节",
    revision: chapter.revision,
    line: 1,
    quote: "绘光走进山林。",
  };
  let fail = true;
  let finishPreview = () => {};
  const previewReady = new Promise<void>((resolve) => {
    finishPreview = resolve;
  });
  const request = vi.fn<CharacterRequest>(async (action) => {
    if (action.kind === "notebooks") return { notebooks: [{ id: "book", title: "小说" }] };
    if (action.kind === "discover") {
      const query = action.query as { after?: string };
      if (!query.after) return { entries: [], next: "cursor" };
      if (fail) {
        fail = false;
        throw new Error("temporarily unavailable");
      }
      return { entries: [chapter], next: null };
    }
    if (action.kind === "preview") {
      await previewReady;
      return { baseVersion: 3, excerpts: [evidence] };
    }
    if (action.kind === "save") return { id: "saved" };
    throw new Error("Unexpected action");
  });
  const saved = vi.fn();
  render(
    <NovelChapterDiscovery
      characterId="role"
      characterName="绘光"
      request={request}
      disabled={false}
      onSaved={saved}
    />,
  );
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discover chapter updates" }));
  fireEvent.click(await screen.findByRole("button", { name: "Refresh chapter discovery" }));
  const next = await screen.findByRole("button", { name: "Continue checking chapters" });
  expect(screen.getByText("No matching chapters on this page.")).toBeTruthy();
  expect(screen.queryByText(/Reached the end/)).toBeNull();
  fireEvent.click(next);
  await screen.findByRole("alert");
  fireEvent.click(next);
  fireEvent.click(
    await screen.findByRole("button", { name: "Prepare draft from current chapter" }),
  );
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Refresh chapter discovery" }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Find chapter excerpts" }));
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Close current chapter editor" })
      .disabled,
  ).toBe(true);
  finishPreview();
  fireEvent.click(await screen.findByRole("button", { name: "Use this excerpt" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Proposed character text" }), {
    target: { value: "作者未保存的修改" },
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Close current chapter editor" }));
  expect(confirm).toHaveBeenCalled();
  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Proposed character text" }).value,
  ).toBe("作者未保存的修改");
  fireEvent.click(screen.getByRole("button", { name: "Save character draft" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith({
    kind: "preview",
    characterId: "role",
    facet: "identity",
    notebookId: "book",
    chapterId: "new",
    revision: chapter.revision,
    phrase: "绘光",
  });
  expect(request).toHaveBeenCalledWith({
    kind: "save",
    proposal: expect.objectContaining({ baseVersion: 3, evidence, text: "作者未保存的修改" }),
  });
  expect(request.mock.calls.filter(([action]) => action.kind === "approve")).toHaveLength(0);
  const queries = request.mock.calls
    .filter(([action]) => action.kind === "discover")
    .map(([action]) => action.query);
  expect(queries).toEqual([
    {
      characterId: "role",
      notebookId: "book",
      facet: "identity",
      title: "",
      needsWorkOnly: true,
      after: undefined,
    },
    {
      characterId: "role",
      notebookId: "book",
      facet: "identity",
      title: "",
      needsWorkOnly: true,
      after: "cursor",
    },
    {
      characterId: "role",
      notebookId: "book",
      facet: "identity",
      title: "",
      needsWorkOnly: true,
      after: "cursor",
    },
  ]);
});

it("resets discovery when its notebook, facet, or filter changes", async () => {
  const request = vi.fn<CharacterRequest>(async (action) =>
    action.kind === "notebooks"
      ? {
          notebooks: [
            { id: "one", title: "第一本" },
            { id: "two", title: "第二本" },
          ],
        }
      : { entries: [], next: "old-cursor" },
  );
  render(
    <NovelChapterDiscovery
      characterId="role"
      characterName="绘光"
      request={request}
      disabled={false}
      onSaved={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Discover chapter updates" }));
  fireEvent.click(await screen.findByRole("button", { name: "Refresh chapter discovery" }));
  await screen.findByRole("button", { name: "Continue checking chapters" });
  fireEvent.change(screen.getByRole("combobox", { name: "Notebook" }), {
    target: { value: "two" },
  });
  expect(screen.queryByRole("button", { name: "Continue checking chapters" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Character facet" }), {
    target: { value: "appearance" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Chapter title filter" }), {
    target: { value: "桥" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Only chapters needing a new draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh chapter discovery" }));
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith({
      kind: "discover",
      query: {
        characterId: "role",
        notebookId: "two",
        facet: "appearance",
        title: "桥",
        needsWorkOnly: false,
        after: undefined,
      },
    }),
  );
});
