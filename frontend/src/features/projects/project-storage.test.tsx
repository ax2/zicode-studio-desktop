import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ProjectStoragePanel, type ProjectStorageReport } from "./ProjectStoragePanel";
import { compareProjectStorage } from "./project-storage-comparison";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});
type Entry = ProjectStorageReport["entries"][number];
function entry(path: string, bytes: number, status: Entry["status"] = "complete"): Entry {
  return { path, bytes, files: bytes === 0 ? 0 : 10, skipped: 0, status };
}
function report(entries: Entry[], minute = 0, directory = ""): ProjectStorageReport {
  return { directory, checkedAt: `2026-10-02T08:0${minute}:00Z`, entries };
}

it("compares complete observations and sorts largest absolute changes first", () => {
  const old = report([entry("target", 3072), entry("node_modules", 100), entry("dist", 20)]);
  const next = report([entry("target", 1024), entry("node_modules", 300), entry("dist", 20)]);
  expect(compareProjectStorage(old, next)).toEqual([
    { path: "target", bytes: -2048, files: 0, reason: "complete" },
    { path: "node_modules", bytes: 200, files: 0, reason: "complete" },
    { path: "dist", bytes: 0, files: 0, reason: "complete" },
  ]);
});

it.each([
  "partial",
  "linked",
  "unreadable",
  "not_directory",
] as const)("does not calculate a %s scan as zero or freed bytes", (status) => {
  for (const [before, after] of [
    [entry("target", 1024), entry("target", 0, status)],
    [entry("target", 0, status), entry("target", 1024)],
  ]) {
    expect(compareProjectStorage(report([before]), report([after]))[0]).toEqual({
      path: "target",
      bytes: null,
      files: null,
      reason: "incomplete",
    });
  }
});

it("does not interpret unobserved directories as removed or newly allocated", () => {
  const changes = compareProjectStorage(
    report([entry("target", 1024)]),
    report([entry("dist", 2048)]),
  );
  expect(changes.every((change) => change.bytes === null && change.reason === "not-observed")).toBe(
    true,
  );
});

it("rejects comparisons between different selected directories", () => {
  expect(() => compareProjectStorage(report([], 0, "api"), report([], 1, "web"))).toThrow(
    "project_storage_scope_changed",
  );
});

it("shows comparison after a second successful scan and keeps failure out of the baseline", async () => {
  setLocale("en");
  const reader = vi
    .fn()
    .mockResolvedValueOnce(report([entry("target", 3072)]))
    .mockResolvedValueOnce(report([entry("target", 1024)], 1))
    .mockRejectedValueOnce(new Error("project_storage_timeout"))
    .mockResolvedValueOnce(report([entry("target", 2048)], 3));
  render(<ProjectStoragePanel workspaceId="project" readStorage={reader} />);
  await screen.findByText("3.0 KiB · 10 files");
  expect(
    screen.queryByRole("region", { name: "Changes since the previous successful scan" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Scan project storage" }));
  const comparison = await screen.findByRole("region", {
    name: "Changes since the previous successful scan",
  });
  expect(within(comparison).getByText("−2.0 KiB · 0 files")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Scan project storage" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("region", { name: "Changes since the previous successful scan" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Scan project storage" }));
  expect(
    within(
      await screen.findByRole("region", { name: "Changes since the previous successful scan" }),
    ).getByText("+1.0 KiB · 0 files"),
  ).toBeTruthy();
});

it("resets comparison and ignores a pending scan when switching projects", async () => {
  setLocale("en");
  let finish!: (value: ProjectStorageReport) => void;
  const reader = vi
    .fn()
    .mockResolvedValueOnce(report([entry("target", 1024)]))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(report([entry("dist", 2048)]));
  const view = render(<ProjectStoragePanel workspaceId="a" readStorage={reader} />);
  await screen.findByText("target");
  fireEvent.click(screen.getByRole("button", { name: "Scan project storage" }));
  await screen.findByText("Scanning project storage…");
  view.rerender(<ProjectStoragePanel workspaceId="b" readStorage={reader} />);
  await screen.findByText("dist");
  await act(async () => finish(report([entry("target", 4096)], 1)));
  expect(screen.queryByText("target")).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Changes since the previous successful scan" }),
  ).toBeNull();
});

it("rejects an invalid report instead of adding it to the comparison", async () => {
  setLocale("en");
  const reader = vi
    .fn()
    .mockResolvedValueOnce(report([entry("target", 1024)]))
    .mockResolvedValueOnce(report([entry("../target", 0)], 1));
  render(<ProjectStoragePanel workspaceId="project" readStorage={reader} />);
  await screen.findByText("target");
  fireEvent.click(screen.getByRole("button", { name: "Scan project storage" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("region", { name: "Changes since the previous successful scan" }),
  ).toBeNull();
});
