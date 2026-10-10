import { t } from "../../shared/i18n.js";
import { toolPathError } from "./tool-path-errors";

export interface TerminalInfo {
  id: string;
  openIntentId?: string | null;
  workspaceId: string;
  directory?: string;
  shell: string;
  pythonEnvironment?: string | null;
  status: "running" | "stopping" | "closed" | "exited" | "failed";
  cols: number;
  rows: number;
  exitCode: number | null;
  outputClosed: boolean;
  outputEnd: number;
}
export interface TerminalFrame {
  terminal?: TerminalInfo;
  terminals?: TerminalInfo[];
  openIntentSupported?: boolean;
  chunk?: { data: string; nextOffset: number; truncated: boolean };
}
export type TerminalOperation =
  | "terminal_open"
  | "terminal_open_directory"
  | "terminal_list"
  | "terminal_read"
  | "terminal_input"
  | "terminal_resize"
  | "terminal_close";
export interface TerminalApi {
  canUse: boolean;
  request(
    operation: TerminalOperation,
    workspace: string,
    parameters?: Record<string, unknown>,
  ): Promise<TerminalFrame>;
}
export function terminalError(
  error: unknown,
  fallback = t(
    "Terminal connection failed. Input may already have been sent; reconnect before typing again.",
  ),
): string {
  const environmentError = toolPathError(error);
  if (environmentError) return environmentError;
  const code = error instanceof Error ? error.message : "";
  if (
    [
      "task_directory_invalid",
      "task_directory_unavailable",
      "terminal_directory_unavailable",
    ].includes(code)
  )
    return t(
      "The terminal startup directory is unavailable. Refresh project directories and select it again.",
    );
  if (code === "terminal_directory_unconfirmed")
    return t(
      "The host did not confirm the terminal startup directory. Refresh the terminal list before trying again.",
    );
  if (code === "terminal_subdirectory_unsupported")
    return t(
      "Update the desktop host to open a terminal in a subproject, or select the workspace root.",
    );
  if (code === "task_python_environment_invalid" || code === "task_python_conda_invalid")
    return t(
      "The selected directory's Python environment is incomplete or points outside the project. Repair .venv or .conda before opening a terminal.",
    );
  if (code === "terminal_limit_reached")
    return t("Close an active terminal first. Up to two per project and eight per host can run.");
  if (code === "terminal_shell_unavailable" || code === "terminal_open_failed")
    return t(
      "The host could not start its default shell. Check the installed shell and PTY support.",
    );
  if (code === "terminal_not_found")
    return t("This terminal no longer exists. Refresh the terminal list or open a new terminal.");
  if (code === "terminal_open_intent_conflict")
    return t("This terminal start request belongs to another project or directory. Refresh terminals before retrying.");
  if (code === "terminal_open_intent_expired")
    return t("This terminal start request is no longer retained by the host. Refresh terminals before opening a new one.");
  return fallback;
}
export function terminalStatus(status: TerminalInfo["status"]): string {
  return t(
    {
      running: "Terminal running",
      stopping: "Terminal stopping",
      closed: "Terminal closed",
      exited: "Shell exited",
      failed: "Terminal failed",
    }[status],
  );
}
export interface TerminalEngine {
  write(bytes: Uint8Array, done: () => void, replay?: boolean): void;
  reset(): void;
  enableInput(enabled: boolean): void;
  dispose(): void;
}
export interface EngineOptions {
  onData: (bytes: Uint8Array) => void;
  onResize: (cols: number, rows: number) => void;
}
export async function loadTerminalEngine() {
  // Separate entry: the terminal library is loaded only when a session is selected.
  const url = "/native/react/project-terminal-engine.js";
  return import(/* @vite-ignore */ url) as Promise<{
    createTerminal: (element: HTMLElement, options: EngineOptions) => Promise<TerminalEngine>;
  }>;
}
