import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NovelDraftPanel } from "./NovelDraftPanel";
import type { CharacterRequest } from "./useCharacterRecords";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("uses a pinned Notes excerpt and keeps unsaved author edits when approving a draft", async () => {
  const evidence = {
    workspaceId: "workspace",
    notebookId: "book",
    chapterId: "chapter",
    chapterTitle: "第一章",
    revision: "sha256:chapter-revision",
    line: 2,
    quote: "绘光守在桥头。",
  };
  let draftId = "";
  let approved = false;
  const actions: Record<string, unknown>[] = [];
  const invoke = vi.fn<Invoke>(async (_command, input) => {
    const request = input.request as {
      kind: string;
      sceneId?: string;
      libraryId?: string;
      action?: Record<string, unknown>;
    };
    if (request.kind === "list")
      return {
        libraryId: "library",
        page: { assets: [], next: null },
        charactersAvailable: true,
        hasCharacters: true,
      };
    const action = request.action;
    if (request.kind === "characters" && action) {
      if (action.kind === "list") return { entries: [{ id: "role", name: "绘光" }], next: null };
      if (action.kind === "referenceSets" || action.kind === "recipes")
        return { entries: [], next: null };
      if (action.kind === "revisions")
        return {
          entries: approved
            ? [{ version: 2, text: "守桥人", manuscript: evidence }]
            : [{ version: 1, text: "原角色设定" }],
          next: null,
        };
    }
    if (request.kind === "novelDrafts" && action) {
      expect(request.sceneId).toBe("writing");
      expect(request.libraryId).toBe("library");
      expect(input.workspaceId).toBe("workspace");
      actions.push(action);
      if (action.kind === "list")
        return {
          entries: draftId
            ? [
                {
                  id: draftId,
                  facet: "identity",
                  baseVersion: 1,
                  approvedVersion: approved ? 2 : null,
                  evidence,
                  text: "守桥人",
                },
              ]
            : [],
          next: null,
        };
      if (action.kind === "notebooks") return { notebooks: [{ id: "book", title: "小说" }] };
      if (action.kind === "chapters")
        return {
          chapters: [{ id: "chapter", title: "第一章", revision: evidence.revision }],
          more: false,
        };
      if (action.kind === "preview") return { baseVersion: 1, excerpts: [evidence] };
      if (action.kind === "save") {
        const proposal = action.proposal as { draftId: string };
        draftId = proposal.draftId;
        expect(proposal).toMatchObject({
          characterId: "role",
          evidence,
          baseVersion: 1,
          text: "守桥人",
        });
        return { id: draftId };
      }
      if (action.kind === "approve") {
        expect(action.id).toBe(draftId);
        approved = true;
        return { version: 2 };
      }
    }
    return { job: null };
  });

  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" sceneId="writing" />);
  fireEvent.click(await screen.findByRole("button", { name: "Characters" }));
  await screen.findByRole("option", { name: "绘光" });
  fireEvent.change(screen.getByRole("combobox", { name: "Choose character" }), {
    target: { value: "role" },
  });
  const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Identity" });
  await waitFor(() => expect(editor.value).toBe("原角色设定"));
  fireEvent.change(editor, { target: { value: "尚未保存的作者文字" } });
  expect(actions).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Manuscript character drafts" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose chapter from Notes" }));
  fireEvent.click(await screen.findByRole("button", { name: "Load chapters" }));
  fireEvent.click(await screen.findByRole("button", { name: "Find chapter excerpts" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use this excerpt" }));
  expect(actions).toContainEqual({
    kind: "preview",
    characterId: "role",
    facet: "identity",
    notebookId: "book",
    chapterId: "chapter",
    revision: evidence.revision,
    phrase: "绘光",
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Proposed character text" }), {
    target: { value: "守桥人" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save character draft" }));
  const pending = await screen.findByText(/Pending approval/);
  expect(approved).toBe(false);
  fireEvent.click(pending);
  fireEvent.click(screen.getByRole("button", { name: "Approve as character version" }));
  await screen.findByText(/Approved version 2/);
  await screen.findByRole("button", { name: "Load latest version into editor" });
  expect(editor.value).toBe("尚未保存的作者文字");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save new version" }).disabled).toBe(
    true,
  );
});

it("reviews loaded chapters and prepares a separate draft pinned to the latest revision", async () => {
  const previous = {
    workspaceId: "workspace",
    notebookId: "book",
    chapterId: "bridge",
    chapterTitle: "桥头",
    revision: "sha256:old",
    line: 2,
    quote: "绘光守桥。",
  };
  const latest = { id: "bridge", title: "雨中的桥头", revision: "sha256:new" };
  const excerpt = {
    ...previous,
    chapterTitle: latest.title,
    revision: latest.revision,
    quote: "绘光等雨停。",
  };
  const drafts = [
    { id: "changed", evidence: previous },
    { id: "missing", evidence: { ...previous, chapterId: "market", chapterTitle: "市集" } },
  ].map((entry) => ({
    ...entry,
    facet: "identity",
    text: "旧草案",
    baseVersion: 1,
    approvedVersion: null,
  }));
  const request = vi.fn<CharacterRequest>(async (action) => {
    if (action.kind === "list") return { entries: drafts, next: null };
    if (action.kind === "review")
      return {
        entries: [
          { id: "changed", latest, chapterChanged: true, baseChanged: true },
          { id: "missing", latest: null, chapterChanged: false, baseChanged: false },
        ],
      };
    if (action.kind === "preview") return { baseVersion: 2, excerpts: [excerpt] };
    if (action.kind === "save") return { id: "new" };
    throw new Error("Unexpected action");
  });
  const approved = vi.fn();
  render(
    <NovelDraftPanel
      characterId="role"
      characterName="绘光"
      request={request}
      disabled={false}
      onApproved={approved}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Manuscript character drafts" }));
  const check = await screen.findByRole("button", { name: "Check loaded chapters for changes" });
  expect(request.mock.calls.map(([action]) => action.kind)).toEqual(["list"]);
  fireEvent.click(check);
  const changed = await screen.findByText(/桥头.*Review needed/);
  expect(request).toHaveBeenCalledWith({
    kind: "review",
    characterId: "role",
    draftIds: ["changed", "missing"],
  });
  expect(screen.getByText(/市集.*Review needed/)).toBeTruthy();
  const card = changed.closest("details");
  if (!card) throw new Error("Missing draft details");
  fireEvent.click(changed);
  const entry = within(card);
  expect(
    entry.getByRole<HTMLButtonElement>("button", { name: "Approve as character version" }).disabled,
  ).toBe(true);
  fireEvent.click(entry.getByRole("button", { name: "Prepare draft from current chapter" }));
  fireEvent.click(entry.getByRole("button", { name: "Find chapter excerpts" }));
  expect(request).toHaveBeenCalledWith({
    kind: "preview",
    characterId: "role",
    facet: "identity",
    notebookId: "book",
    chapterId: "bridge",
    revision: latest.revision,
    phrase: "绘光",
  });
  fireEvent.click(await entry.findByRole("button", { name: "Use this excerpt" }));
  fireEvent.click(entry.getByRole("button", { name: "Save character draft" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({
      kind: "save",
      proposal: expect.objectContaining({
        draftId: expect.any(String),
        baseVersion: 2,
        evidence: excerpt,
        text: excerpt.quote,
      }),
    }),
  );
  expect(approved).not.toHaveBeenCalled();
});
