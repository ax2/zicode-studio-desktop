import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { ProjectTerminalPanel } from "./ProjectTerminalPanel";
import type { TerminalApi, TerminalInfo } from "./project-terminal";

const engine = vi.hoisted(() => ({
  write: vi.fn((_bytes: Uint8Array, done: () => void) => done()),
  reset: vi.fn(),
  enableInput: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("./project-terminal", async (original) => ({
  ...(await original<typeof import("./project-terminal")>()),
  loadTerminalEngine: async () => ({ createTerminal: async () => engine }),
}));
const info: TerminalInfo = {
  id: "term",
  workspaceId: "project",
  shell: "PowerShell",
  status: "running",
  cols: 80,
  rows: 24,
  exitCode: null,
  outputClosed: false,
  outputEnd: 0,
};
beforeEach(() => {
  setLocale("en");
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

it("starts only on explicit action, reconnects without spawning and closes the chosen session", async () => {
  let sessions: TerminalInfo[] = [];
  const api: TerminalApi = {
    canUse: true,
    request: vi.fn(async (operation) => {
      if (operation === "terminal_list") return { terminals: sessions };
      if (operation === "terminal_open") {
        sessions = [info];
        return { terminal: info };
      }
      if (operation === "terminal_close") {
        sessions = [{ ...info, status: "closed", outputClosed: true }];
        return {};
      }
      return { terminal: sessions[0], chunk: { data: "", nextOffset: 0, truncated: false } };
    }),
  };
  render(<ProjectTerminalPanel workspaceId="project" api={api} />);
  await waitFor(() => expect(api.request).toHaveBeenCalledWith("terminal_list", "project"));
  expect(
    vi.mocked(api.request).mock.calls.some(([operation]) => operation === "terminal_open"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
  await screen.findByRole("group", { name: "Interactive terminal" });
  fireEvent.click(screen.getByRole("button", { name: "Reconnect terminal" }));
  expect(
    vi.mocked(api.request).mock.calls.filter(([operation]) => operation === "terminal_open"),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Stop terminal" }));
  await waitFor(() =>
    expect(api.request).toHaveBeenCalledWith("terminal_close", "project", { terminalId: "term" }),
  );
});

it("shows a failed open without retrying the launch", async () => {
  const api: TerminalApi = {
    canUse: true,
    request: vi.fn(async (operation) => {
      if (operation === "terminal_open") throw new Error("terminal_shell_unavailable");
      return { terminals: [] };
    }),
  };
  render(<ProjectTerminalPanel workspaceId="project" api={api} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "New terminal" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("default shell"),
  );
  expect(
    vi.mocked(api.request).mock.calls.filter(([operation]) => operation === "terminal_open"),
  ).toHaveLength(1);
});

it("does not read or expose terminal controls to remote clients", async () => {
  const api: TerminalApi = { canUse: false, request: vi.fn() };
  render(<ProjectTerminalPanel workspaceId="project" api={api} />);
  expect(
    screen.getByText("Interactive terminals are available in the desktop app only."),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New terminal" })).toBeNull();
  expect(api.request).not.toHaveBeenCalled();
});
