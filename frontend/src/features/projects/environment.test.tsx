import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { EnvironmentPanel, type EnvironmentReport } from "./EnvironmentPanel";
import { ProjectMain, ProjectNav } from "./ProjectWorkspaceApp";
import { createProjectWorkspaceStore } from "./store";

const report: EnvironmentReport = {
  platform: "windows",
  architecture: "x86_64",
  piVersion: "0.83.0",
  checkedAt: "2026-09-26T01:00:00Z",
  manifests: [
    {
      name: "package.json",
      kind: "javascript",
      status: "detected",
      requirements: [{ tool: "node", constraint: ">=22" }],
    },
  ],
  tools: [
    { id: "node", status: "ready", version: "v24.0.0", executable: "C:/tools/node.exe" },
    { id: "go", status: "missing", version: null, executable: null },
    { id: "python", status: "timeout", version: null, executable: "C:/tools/python.exe" },
  ],
};
afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

it("compares declared JavaScript requirements and retains tool recovery guidance", async () => {
  setLocale("zh-CN");
  render(<EnvironmentPanel workspaceId="a" revision={0} readEnvironment={async () => report} />);
  await screen.findByText("v24.0.0");
  expect(screen.getByText("node: >=22")).toBeTruthy();
  expect(screen.getByText("满足版本要求")).toBeTruthy();
  expect(screen.getByText("宿主环境中未找到")).toBeTruthy();
  expect(screen.getByText("版本检查超时")).toBeTruthy();
  expect(screen.getByText("内置 Pi（锁定版本）")).toBeTruthy();
});

it("shows actionable mismatches without treating unavailable tools as compatible", async () => {
  setLocale("en");
  render(
    <EnvironmentPanel
      workspaceId="a"
      revision={0}
      readEnvironment={async () => ({
        ...report,
        manifests: [
          {
            name: "package.json",
            kind: "javascript",
            status: "detected",
            requirements: [
              { tool: "node", constraint: "^22.0.0" },
              { tool: "packageManager", constraint: "pnpm@10.0.0" },
              { tool: "bun", constraint: ">=1", truncated: true },
            ],
          },
        ],
        tools: [
          ...report.tools,
          { id: "pnpm", status: "missing", version: null, executable: null },
        ],
      })}
    />,
  );
  await screen.findByText("Version requirement not satisfied");
  expect(screen.getByText("Required tool not found")).toBeTruthy();
  expect(screen.getByText("Version requirement was truncated; comparison skipped")).toBeTruthy();
  expect(screen.queryByText("Version requirement satisfied")).toBeNull();
});

it("discards a late result when switching projects and supports retry after failure", async () => {
  setLocale("en");
  let resolve!: (value: EnvironmentReport) => void;
  const old = new Promise<EnvironmentReport>((done) => {
    resolve = done;
  });
  const readEnvironment = vi
    .fn()
    .mockReturnValueOnce(old)
    .mockRejectedValueOnce(new Error("disconnected"))
    .mockResolvedValueOnce({ ...report, platform: "linux" });
  const view = render(
    <EnvironmentPanel workspaceId="a" revision={0} readEnvironment={readEnvironment} />,
  );
  view.rerender(
    <EnvironmentPanel workspaceId="b" revision={1} readEnvironment={readEnvironment} />,
  );
  await screen.findByText(
    "Could not inspect the environment. Update or reconnect the desktop host and retry.",
  );
  await act(async () => resolve(report));
  expect(screen.queryByText("v24.0.0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check environment again" }));
  await screen.findByText("linux / x86_64");
  expect(readEnvironment).toHaveBeenLastCalledWith("b");
});

it("only probes when the user opens the environment view", async () => {
  setLocale("en");
  const workspaceEnvironment = vi.fn(async () => ({ report }));
  const store = createProjectWorkspaceStore({
    getTarget: () => ({ workspaceId: "a" }),
    dataGateway: { workspaceEnvironment },
  });
  render(
    <>
      <ProjectNav store={store} />
      <ProjectMain store={store} />
    </>,
  );
  expect(workspaceEnvironment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Development environment" }));
  await screen.findByText("v24.0.0");
  expect(workspaceEnvironment).toHaveBeenCalledWith("a");
});

it("distinguishes an unreadable manifest from an empty project", async () => {
  setLocale("en");
  const readEnvironment = vi
    .fn()
    .mockResolvedValueOnce({
      ...report,
      manifests: [
        { name: "package.json", kind: "javascript", status: "invalid", requirements: [] },
      ],
    })
    .mockResolvedValueOnce({ ...report, manifests: [] });
  render(<EnvironmentPanel workspaceId="a" revision={0} readEnvironment={readEnvironment} />);
  await screen.findByText(
    "Manifest could not be read safely. Check its format, size and location.",
  );
  expect(screen.queryByText("No supported manifests found in the selected directory.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check environment again" }));
  await screen.findByText("No supported manifests found in the selected directory.");
});

it("labels Go recommendations separately and exposes unresolved Rust toolchains", async () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  setLocale("en");
  render(<EnvironmentPanel workspaceId="a" revision={0} readEnvironment={async () => ({
    ...report,
    manifests: [
      { name: "go.mod", kind: "go", status: "detected", requirements: [
        { tool: "go", kind: "minimum", constraint: "1.23" },
        { tool: "go", kind: "recommended", constraint: "go1.23.4" },
      ] },
      { name: "Cargo.toml", kind: "rust", status: "detected", requirements: [{ tool: "rustc", kind: "inherited", constraint: "workspace" }] },
      { name: "rust-toolchain.toml", kind: "rust", status: "conflicting", requirements: [] },
    ],
    tools: [{ id: "go", status: "ready", version: "go version go1.23.0 windows/amd64", executable: "C:/Go/bin/go.exe" }],
  })} />);
  await screen.findByText("Version requirement satisfied");
  expect(screen.getByText("Host version is below the recommended toolchain")).toBeTruthy();
  expect(screen.getByText("Resolve this toolchain or inherited declaration in your system terminal.")).toBeTruthy();
  expect(screen.getByText("Both Rust toolchain files exist. Keep one declaration before comparing versions.")).toBeTruthy();
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

it("shows the detected Python version and directs users to its source", async () => {
  setLocale("en");
  render(<EnvironmentPanel workspaceId="a" revision={0} readEnvironment={async () => ({
    ...report,
    manifests: [{ name: "pyproject.toml", kind: "python", status: "detected", requirements: [{
      tool: "python", kind: "pep440", constraint: ">=3.12,!=3.13.*", truncated: false,
      assessment: { status: "satisfied", version: "3.14.7", observedVersion: "Python 3.14.7" },
    }] }],
    tools: [{ id: "python", status: "ready", version: "Python 3.14.7", executable: "/host/python3" }],
  })} />);
  await screen.findByText("Version requirement satisfied");
  expect(
    screen.getByText(
      "Compared with the detected Python interpreter for this directory; check its source below.",
    ),
  ).toBeTruthy();
  expect(screen.getByText("python: >=3.12,!=3.13.*")).toBeTruthy();
  expect(screen.getByText("Detected version: python 3.14.7")).toBeTruthy();
});
