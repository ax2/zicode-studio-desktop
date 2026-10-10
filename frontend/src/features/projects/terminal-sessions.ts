import { t } from "../../shared/i18n";
import { type TerminalApi, type TerminalInfo, terminalError } from "./project-terminal";
import { sameTerminalInfo, terminalList } from "./terminal-list";
import { openProjectTerminal } from "./terminal-start";

interface TerminalSessionState {
  sessions: TerminalInfo[];
  selected: string;
  reading: boolean;
  loaded: boolean;
  pending: boolean;
  readError: string;
  actionError: string;
  creationUncertain: boolean;
  supportsOpenIntent: boolean;
  retryDirectory: string | null;
}
const initialState = (): TerminalSessionState => ({
  sessions: [],
  selected: "",
  reading: false,
  loaded: false,
  pending: false,
  readError: "",
  actionError: "",
  creationUncertain: false,
  supportsOpenIntent: false,
  retryDirectory: null,
});

/** One API/workspace lifetime. No retries of writes, and no automatic terminal creation. */
export function createTerminalSessions(api: TerminalApi, workspace?: string | null) {
  let state = initialState();
  const listeners = new Set<() => void>();
  const infoVersions = new Map<string, number>();
  let epoch = 0;
  let readSequence = 0;
  let active = false;
  let openIntent: { id: string; directory: string } | null = null;
  const publish = (patch: Partial<TerminalSessionState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const current = (ticket: number) =>
    active && epoch === ticket && api.canUse && Boolean(workspace);

  async function read(ticket: number, explicit: boolean) {
    if (!current(ticket)) return;
    const sequence = ++readSequence;
    const latest = () => current(ticket) && sequence === readSequence;
    const versions = new Map(infoVersions);
    publish({ reading: true, loaded: false, readError: "" });
    try {
      const response = await api.request("terminal_list", workspace as string);
      if (!latest()) return;
      const sessions = terminalList(response.terminals, workspace as string).map((info) => {
        // A stream update received during this list request is newer UI evidence.
        const previous = state.sessions.find((item) => item.id === info.id);
        return previous && (infoVersions.get(info.id) ?? 0) > (versions.get(info.id) ?? 0)
          ? previous
          : info;
      });
      for (const id of infoVersions.keys()) {
        if (!sessions.some((info) => info.id === id)) infoVersions.delete(id);
      }
      const supportsOpenIntent = response.openIntentSupported === true;
      const pendingIntent = openIntent;
      const matched = pendingIntent
        ? sessions.find(
            (info) =>
              info.openIntentId === pendingIntent.id && info.directory === pendingIntent.directory,
          )
        : undefined;
      if (matched || !supportsOpenIntent) openIntent = null;
      const selected =
        matched?.id ??
        (sessions.some((info) => info.id === state.selected)
          ? state.selected
          : ((sessions.find((info) => info.status === "running") ?? sessions.at(-1))?.id ?? ""));
      publish({
        sessions,
        selected,
        loaded: true,
        supportsOpenIntent,
        retryDirectory: openIntent?.directory ?? null,
        ...(explicit || matched ? { creationUncertain: false } : {}),
      });
    } catch {
      if (latest())
        publish({
          readError: t(
            "Could not refresh terminal sessions. Displayed sessions may be out of date; refresh before creating another terminal.",
          ),
          loaded: false,
        });
    } finally {
      if (latest()) publish({ reading: false });
    }
  }

  async function write(kind: "open" | "stop", action: () => Promise<void>) {
    const ticket = epoch;
    if (!current(ticket) || state.pending) return;
    if (kind === "open" && (!state.loaded || state.reading || state.creationUncertain)) return;
    ++readSequence;
    publish({ pending: true, reading: false, actionError: "" });
    try {
      await action();
    } catch (error) {
      if (current(ticket)) {
        const message = error instanceof Error ? error.message : "";
        const uncertain =
          kind === "open" &&
          [
            "task_request_timed_out",
            "terminal_directory_unconfirmed",
            "terminal_open_intent_unconfirmed",
            "terminal_response_invalid",
            "Host disconnected before the control request completed",
          ].includes(message);
        const needsReview =
          kind === "open" &&
          ["terminal_open_intent_conflict", "terminal_open_intent_expired"].includes(message);
        if (kind === "open" && (!uncertain || needsReview)) openIntent = null;
        publish({
          actionError: terminalError(
            error,
            t(
              "The terminal operation did not finish normally. Refresh sessions before trying again.",
            ),
          ),
          creationUncertain: state.creationUncertain || uncertain || needsReview,
          retryDirectory: openIntent?.directory ?? null,
        });
      }
    } finally {
      if (current(ticket)) {
        await read(ticket, false);
        if (current(ticket)) publish({ pending: false });
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      active = true;
      ++epoch;
      ++readSequence;
      infoVersions.clear();
      state = initialState();
      openIntent = null;
      publish({});
      void read(epoch, false);
    },
    dispose() {
      active = false;
      openIntent = null;
      ++epoch;
      ++readSequence;
    },
    async refresh() {
      if (!current(epoch) || state.pending || state.reading) return;
      publish({ actionError: "" });
      await read(epoch, true);
    },
    open(directory: string) {
      const ticket = epoch;
      return write("open", async () => {
        if (state.supportsOpenIntent && !openIntent)
          openIntent = { id: crypto.randomUUID(), directory };
        const selectedDirectory = openIntent?.directory ?? directory;
        const info = await openProjectTerminal(
          api,
          workspace as string,
          selectedDirectory,
          openIntent?.id,
        );
        openIntent = null;
        if (!current(ticket)) return;
        publish({
          sessions: [...state.sessions.filter((item) => item.id !== info.id), info],
          selected: info.id,
          retryDirectory: null,
        });
      });
    },
    stop(id: string) {
      if (!state.sessions.some((info) => info.id === id && info.status === "running"))
        return Promise.resolve();
      return write("stop", async () => {
        await api.request("terminal_close", workspace as string, { terminalId: id });
      });
    },
    select(id: string) {
      if (current(epoch) && state.sessions.some((info) => info.id === id))
        publish({ selected: id });
    },
    onInfo(info: TerminalInfo) {
      if (!current(epoch) || info.workspaceId !== workspace) return;
      const previous = state.sessions.find((item) => item.id === info.id);
      if (!previous || sameTerminalInfo(previous, info)) return;
      infoVersions.set(info.id, (infoVersions.get(info.id) ?? 0) + 1);
      publish({ sessions: state.sessions.map((item) => (item.id === info.id ? info : item)) });
    },
  };
}
