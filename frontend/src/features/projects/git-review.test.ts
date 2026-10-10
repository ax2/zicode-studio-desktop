import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error plain JS module without type declarations
import { createChatDraftHandoff } from "../../../../public/native/features/chat-draft-handoff.js";
import { setLocale } from "../../shared/i18n";
import { createGitReviewAction, gitReviewDraft } from "./git-review";
import type { ProjectTarget } from "./logic";

afterEach(() => {
  document.body.replaceChildren();
  setLocale("zh-CN");
});

function setup() {
  setLocale("en");
  let source: ProjectTarget | null = {
    workspaceId: "project",
    sceneId: "programming",
    cwd: "E:/projects/example",
  };
  const chat = {
    workspaceId: "project",
    sceneId: "programming",
    instanceId: "runtime",
    sessionId: "session",
  };
  const input = document.createElement("textarea");
  input.value = "Existing draft";
  document.body.append(input);
  const send = vi.fn();
  input.addEventListener("submit", send);
  const syncDraft = vi.fn();
  const notify = vi.fn();
  const activate = vi.fn(async () => {});
  const handoff = createChatDraftHandoff({
    activate,
    getTarget: () => chat,
    isChatActive: () => true,
    getInput: () => input,
    syncDraft,
  });
  const review = createGitReviewAction({ getTarget: () => source, handoff, notify });
  const draft = gitReviewDraft("project", {
    kind: "workspace",
    diff: { mode: "staged", patch: "+const value = 1;\n", truncated: false },
    receivedAt: "2026-10-02T08:00:00Z",
  });
  return {
    review,
    draft,
    activate,
    input,
    notify,
    syncDraft,
    send,
    setSource(value: ProjectTarget | null) {
      source = value;
    },
  };
}

it("appends the displayed review to the current chat draft without submitting", async () => {
  const state = setup();
  await state.review(state.draft);
  expect(state.input.value).toBe(`Existing draft\n\n${state.draft.prompt}`);
  expect(state.syncDraft).toHaveBeenCalledOnce();
  expect(state.send).not.toHaveBeenCalled();
  expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});

it.each([
  ["scene", { workspaceId: "project", sceneId: "writing", cwd: "E:/projects/example" }],
  ["directory", { workspaceId: "project", sceneId: "programming", cwd: "E:/projects/other" }],
  ["workspace", { workspaceId: "other", sceneId: "programming", cwd: "E:/projects/example" }],
  ["closed project", null],
])("rejects a changed source %s during chat activation", async (_kind, next) => {
  const state = setup();
  let finish!: () => void;
  state.activate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const operation = state.review(state.draft);
  expect(state.activate).toHaveBeenCalledOnce();
  state.setSource(next);
  finish();
  await operation;
  expect(state.input.value).toBe("Existing draft");
  expect(state.syncDraft).not.toHaveBeenCalled();
  expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
});

it("preserves the caller's source validity check", async () => {
  const state = setup();
  await state.review({ ...state.draft, isCurrent: () => false });
  expect(state.activate).not.toHaveBeenCalled();
  expect(state.input.value).toBe("Existing draft");
  expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
});

it("rejects a draft explicitly addressed to another scene", async () => {
  const state = setup();
  await state.review({ ...state.draft, scene: "writing" });
  expect(state.activate).not.toHaveBeenCalled();
  expect(state.input.value).toBe("Existing draft");
  expect(state.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
});
