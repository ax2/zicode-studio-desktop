import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { GitDiffPanel } from "./GitDiffPanel";
import type { GitDiff } from "./git-status";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

it("loads a selected comparison, escapes markup and closes the preview", async () => {
  setLocale("en");
  const readDiff = vi.fn(async () => ({
    mode: "staged" as const,
    patch: "+<script>bad()</script>\n",
    truncated: false,
  }));
  render(<GitDiffPanel workspaceId="a" readDiff={readDiff} />);
  expect(readDiff).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View staged diff" }));
  await screen.findByText("Git diff loaded");
  expect(readDiff).toHaveBeenCalledWith("a", "staged");
  expect((screen.getByRole("textbox", { name: "Git diff content" }) as HTMLTextAreaElement).value).toContain(
    "<script>",
  );
  expect(document.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close diff" }));
  expect(screen.queryByText("Git diff loaded")).toBeNull();
});

it("drops a late comparison after changing modes or projects", async () => {
  setLocale("en");
  let resolveOld!: (value: GitDiff) => void;
  const old = new Promise<GitDiff>((resolve) => {
    resolveOld = resolve;
  });
  const readDiff = vi
    .fn()
    .mockReturnValueOnce(old)
    .mockResolvedValueOnce({ mode: "staged", patch: "current staged", truncated: false })
    .mockResolvedValueOnce({ mode: "staged", patch: "project B", truncated: false });
  const view = render(<GitDiffPanel workspaceId="a" readDiff={readDiff} />);
  fireEvent.click(screen.getByRole("button", { name: "View unstaged diff" }));
  fireEvent.click(screen.getByRole("button", { name: "View staged diff" }));
  await screen.findByText("current staged");
  view.rerender(<GitDiffPanel workspaceId="b" readDiff={readDiff} />);
  expect(screen.queryByText("current staged")).toBeNull();
  await screen.findByText("project B");
  await act(async () => resolveOld({ mode: "unstaged", patch: "stale", truncated: false }));
  expect(screen.queryByText("stale")).toBeNull();
});

it("distinguishes failed, truncated and empty results and retries the same selection", async () => {
  setLocale("en");
  const readDiff = vi
    .fn()
    .mockRejectedValueOnce(new Error("git_output_too_large"))
    .mockResolvedValueOnce({ mode: "staged", patch: "", truncated: true })
    .mockResolvedValueOnce({ mode: "staged", patch: "", truncated: false });
  render(<GitDiffPanel workspaceId="a" readDiff={readDiff} />);
  const button = screen.getByRole("button", { name: "View staged diff" });
  fireEvent.click(button);
  await screen.findByText("This diff exceeds the preview limit. Use your Git client to review it.");
  expect(screen.queryByText("No changes in this comparison.")).toBeNull();
  fireEvent.click(button);
  await screen.findByText(
    "Diff preview was truncated. Use your Git client to review the complete changes.",
  );
  expect(screen.queryByText("No changes in this comparison.")).toBeNull();
  fireEvent.click(button);
  await screen.findByText("No changes in this comparison.");
});
