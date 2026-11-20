import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NovelChapterWatch } from "./NovelChapterWatch";
import type { CharacterRequest } from "./useCharacterRecords";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const scope = { characterId: "role", notebookId: "book", facet: "identity" as const };
const running = {
  id: "watch",
  state: "running",
  completedPasses: 1,
  checkedAt: "2026-11-12T02:00:00Z",
  pending: 2,
};

it("resumes saved progress, pages through pending chapters, and leaves the Host running on view close", async () => {
  let state = "interrupted";
  const chapter = { id: "chapter", title: "改稿", revision: "latest", status: "chapterChanged" };
  const request = vi.fn<CharacterRequest>(async (input) => {
    const action = input.action as { kind: string; scope: typeof scope; after?: string };
    expect(input.kind).toBe("watch");
    expect(action.scope).toEqual(scope);
    if (action.kind === "start") state = "running";
    if (action.kind === "entries")
      return { entries: action.after ? [chapter] : [], next: action.after ? null : "cursor" };
    return { watch: { ...running, state } };
  });
  const choose = vi.fn();
  const view = render(
    <NovelChapterWatch
      {...scope}
      request={request}
      disabled={false}
      editing={false}
      onChoose={choose}
    />,
  );
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Automatic chapter checks" }));
  fireEvent.click(await screen.findByRole("button", { name: "Resume chapter watching" }));
  await screen.findByRole("button", { name: "Pause chapter watching" });
  expect(request).toHaveBeenCalledWith({ kind: "watch", action: { kind: "start", scope } });
  fireEvent.click(screen.getByRole("button", { name: "Show watched chapters" }));
  fireEvent.click(await screen.findByRole("button", { name: "More watched chapters" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Prepare draft from watched chapter" }),
  );
  expect(choose).toHaveBeenCalledWith(chapter);
  expect(request).toHaveBeenCalledWith({
    kind: "watch",
    action: { kind: "entries", scope, after: "cursor" },
  });
  view.unmount();
  expect(
    request.mock.calls.some(([input]) => (input.action as { kind: string }).kind === "pause"),
  ).toBe(false);
  expect(state).toBe("running");
});

it("does not let a delayed status response undo an explicit pause", async () => {
  vi.useFakeTimers();
  let polls = 0;
  let finishPoll: (value: unknown) => void = () => {};
  const request = vi.fn<CharacterRequest>(async (input) => {
    const action = input.action as { kind: string };
    if (action.kind === "pause") return { watch: { ...running, state: "paused" } };
    if (++polls === 1) return { watch: running };
    return new Promise((resolve) => {
      finishPoll = resolve;
    });
  });
  render(
    <NovelChapterWatch
      {...scope}
      request={request}
      disabled={false}
      editing={false}
      onChoose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Automatic chapter checks" }));
  await act(async () => {});
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  fireEvent.click(screen.getByRole("button", { name: "Pause chapter watching" }));
  await act(async () => {});
  expect(screen.getByText("Chapter watching paused")).toBeTruthy();
  await act(async () => {
    finishPoll({ watch: running });
  });
  expect(screen.getByText("Chapter watching paused")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Resume chapter watching" })).toBeTruthy();
});

it("can pause while editing a pinned chapter and reports permission failures without clearing the draft", async () => {
  const request = vi.fn<CharacterRequest>(async (input) => {
    if ((input.action as { kind: string }).kind === "pause")
      throw new Error("permission unavailable");
    return { watch: running };
  });
  const choose = vi.fn();
  render(
    <NovelChapterWatch
      {...scope}
      request={request}
      disabled={false}
      editing={true}
      onChoose={choose}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Automatic chapter checks" }));
  fireEvent.click(await screen.findByRole("button", { name: "Pause chapter watching" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Show watched chapters" }).disabled,
  ).toBe(true);
  expect(choose).not.toHaveBeenCalled();
});
