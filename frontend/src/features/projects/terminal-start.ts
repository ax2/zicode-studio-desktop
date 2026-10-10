import type { TerminalApi, TerminalFrame } from "./project-terminal";

export async function openProjectTerminal(
  api: TerminalApi,
  workspace: string,
  directory: string,
  openIntentId?: string,
) {
  let result: TerminalFrame;
  try {
    // A distinct operation prevents older Hosts from silently ignoring the directory.
    result = await api.request(directory ? "terminal_open_directory" : "terminal_open", workspace, {
      cols: 80,
      rows: 24,
      ...(directory ? { directory } : {}),
      ...(openIntentId ? { openIntentId } : {}),
    });
  } catch (error) {
    if (
      directory &&
      error instanceof Error &&
      [
        "terminal_operation_unsupported",
        "Host operation is not implemented on protocol v2",
        "host_operation_unimplemented",
      ].includes(error.message)
    )
      throw new Error("terminal_subdirectory_unsupported");
    throw error;
  }
  const info = result.terminal;
  if (
    !info ||
    typeof info.id !== "string" ||
    !info.id ||
    info.workspaceId !== workspace ||
    (openIntentId && info.openIntentId !== openIntentId) ||
    (info.directory !== directory && (directory !== "" || info.directory !== undefined))
  ) {
    throw new Error(openIntentId ? "terminal_open_intent_unconfirmed" : "terminal_directory_unconfirmed");
  }
  return info;
}
