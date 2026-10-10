import type { TerminalInfo } from "./project-terminal";

export function terminalList(value: unknown, workspace: string): TerminalInfo[] {
  if (!Array.isArray(value)) throw new Error("terminal_response_invalid");
  const ids = new Set<string>();
  for (const info of value) {
    if (
      !info ||
      typeof info.id !== "string" ||
      !info.id ||
      ids.has(info.id) ||
      info.workspaceId !== workspace ||
      typeof info.shell !== "string" ||
      !["running", "stopping", "closed", "exited", "failed"].includes(info.status) ||
      !Number.isSafeInteger(info.outputEnd) ||
      info.outputEnd < 0 ||
      typeof info.outputClosed !== "boolean" ||
      !Number.isInteger(info.cols) ||
      info.cols < 2 ||
      info.cols > 500 ||
      !Number.isInteger(info.rows) ||
      info.rows < 2 ||
      info.rows > 200 ||
      (info.exitCode !== null && (!Number.isInteger(info.exitCode) || info.exitCode < 0)) ||
      (info.directory !== undefined && typeof info.directory !== "string") ||
      (info.openIntentId != null && typeof info.openIntentId !== "string") ||
      (info.pythonEnvironment != null && typeof info.pythonEnvironment !== "string")
    ) {
      throw new Error("terminal_response_invalid");
    }
    ids.add(info.id);
  }
  return value;
}

export function sameTerminalInfo(left: TerminalInfo, right: TerminalInfo) {
  return (
    left.id === right.id &&
    left.openIntentId === right.openIntentId &&
    left.workspaceId === right.workspaceId &&
    left.status === right.status &&
    left.cols === right.cols &&
    left.rows === right.rows &&
    left.exitCode === right.exitCode &&
    left.outputClosed === right.outputClosed &&
    left.outputEnd === right.outputEnd &&
    left.directory === right.directory &&
    left.pythonEnvironment === right.pythonEnvironment &&
    left.shell === right.shell
  );
}
