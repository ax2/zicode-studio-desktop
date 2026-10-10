import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { GitHistoryPanel } from "./GitHistoryPanel";
import { type GitHistory, parseGitHistory } from "./git-history";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});
const head = "a".repeat(40);
function first(): GitHistory {
  return {
    head,
    hasMore: true,
    nextCursor: { head, offset: 50 },
    commits: Array.from({ length: 50 }, (_, index) => ({
      oid: (index + 1).toString(16).padStart(40, "0"),
      author: "QA",
      authoredAt: "2026-10-02T08:00:00Z",
      message: `Recent ${index}`,
      truncated: false,
    })),
  };
}
function last(): GitHistory {
  return {
    head,
    hasMore: false,
    nextCursor: null,
    commits: [{ ...first().commits[0], oid: "b".repeat(40), message: "Older change" }],
  };
}
function props(readHistory = vi.fn(async () => first())) {
  return {
    workspaceId: "project",
    revision: 0,
    readHistory,
    readCommitDiff: vi.fn(),
    prepareGitReview: vi.fn(),
  };
}

it("browses older and newer pages at the captured HEAD and refreshes from the current HEAD", async () => {
  setLocale("en");
  const read = vi
    .fn()
    .mockResolvedValueOnce(first())
    .mockResolvedValueOnce(last())
    .mockResolvedValueOnce(first())
    .mockResolvedValueOnce({ ...last(), head: "c".repeat(40) });
  render(<GitHistoryPanel {...props(read)} />);
  fireEvent.click(screen.getByRole("button", { name: "View commit history" }));
  await screen.findByText("Recent 0", { selector: "strong" });
  fireEvent.click(screen.getByRole("button", { name: "Older commits" }));
  await screen.findByText("Older change", { selector: "strong" });
  expect(read).toHaveBeenLastCalledWith("project", { head, offset: 50 });
  expect(
    (screen.getByRole("button", { name: "Older commits" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Newer commits" }));
  await screen.findByText("Recent 0", { selector: "strong" });
  expect(read).toHaveBeenLastCalledWith("project", { head, offset: 0 });
  fireEvent.click(screen.getByRole("button", { name: "Refresh commit history" }));
  await screen.findByText("c".repeat(40));
  expect(read).toHaveBeenLastCalledWith("project");
});

it("clears pagination on project change and discards the previous project's late page", async () => {
  setLocale("en");
  let resolve!: (history: GitHistory) => void;
  const read = vi
    .fn()
    .mockResolvedValueOnce(first())
    .mockImplementationOnce(
      () =>
        new Promise<GitHistory>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce({ ...last(), head: "c".repeat(40) });
  const view = render(<GitHistoryPanel {...props(read)} />);
  fireEvent.click(screen.getByRole("button", { name: "View commit history" }));
  await screen.findByText("Recent 0", { selector: "strong" });
  fireEvent.click(screen.getByRole("button", { name: "Older commits" }));
  view.rerender(<GitHistoryPanel {...props(read)} workspaceId="other" />);
  await screen.findByText("c".repeat(40));
  expect(read).toHaveBeenLastCalledWith("other");
  await act(async () => resolve(last()));
  expect(screen.queryByText(head)).toBeNull();
});

it("allows returning to newer history after an older-page failure", async () => {
  setLocale("en");
  const read = vi
    .fn()
    .mockResolvedValueOnce(first())
    .mockRejectedValueOnce(new Error("git_timeout"))
    .mockResolvedValueOnce(first());
  render(<GitHistoryPanel {...props(read)} />);
  fireEvent.click(screen.getByRole("button", { name: "View commit history" }));
  await screen.findByText("Recent 0", { selector: "strong" });
  fireEvent.click(screen.getByRole("button", { name: "Older commits" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Newer commits" }));
  await screen.findByText("Recent 0", { selector: "strong" });
});

it("keeps old hosts readable without inventing a cursor", async () => {
  setLocale("en");
  const history = first();
  delete history.nextCursor;
  render(<GitHistoryPanel {...props(vi.fn(async () => history))} />);
  fireEvent.click(screen.getByRole("button", { name: "View commit history" }));
  await screen.findByText("Recent 0", { selector: "strong" });
  expect(screen.queryByRole("button", { name: "Older commits" })).toBeNull();
  expect(parseGitHistory(history)).toBe(history);
});

it.each([
  { head: "--all", offset: 50 },
  { head, offset: -50 },
  { head, offset: 1 },
  { head, offset: 4294967300 },
])("rejects malformed next cursor %j", (cursor) => {
  expect(() => parseGitHistory({ ...first(), nextCursor: cursor })).toThrow("git_history_invalid");
});

it("requires matching HEAD and consecutive offsets for a continuation response", () => {
  expect(() => parseGitHistory({ ...last(), head: "c".repeat(40) }, { head, offset: 50 })).toThrow(
    "git_history_invalid",
  );
  expect(() => parseGitHistory({ ...first(), nextCursor: { head, offset: 100 } })).toThrow(
    "git_history_invalid",
  );
  expect(
    parseGitHistory({ ...first(), nextCursor: { head, offset: 100 } }, { head, offset: 50 })
      .nextCursor?.offset,
  ).toBe(100);
});
