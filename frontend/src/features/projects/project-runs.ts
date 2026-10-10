import { t } from "../../shared/i18n";
import { parseProjectHistory, parseProjectRun } from "./project-run-records";
import {
  isActiveRun,
  type ProjectRun,
  type ProjectRunHistory,
  type ProjectRunnerApi,
  taskError,
} from "./project-runner";

interface State {
  runs: ProjectRun[];
  historyStatus: ProjectRunHistory["historyStatus"] | null;
  receivedAt: string | null;
  loaded: boolean;
  reading: boolean;
  pending: boolean;
  readError: string;
  actionError: string;
  creationUncertain: boolean;
}
const initial = (): State => ({
  runs: [],
  historyStatus: null,
  receivedAt: null,
  loaded: false,
  reading: false,
  pending: false,
  readError: "",
  actionError: "",
  creationUncertain: false,
});

export function createProjectRuns(api: ProjectRunnerApi, workspace?: string | null) {
  let state = initial();
  let active = false;
  let epoch = 0;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const current = (ticket: number) => active && ticket === epoch && Boolean(workspace);
  const cancelTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  function schedule(ticket: number) {
    if (!current(ticket) || state.pending) return;
    cancelTimer();
    timer = setTimeout(() => {
      timer = undefined;
      void read(ticket, false);
    }, 1500);
  }
  async function read(ticket: number, explicit: boolean) {
    if (!current(ticket)) return;
    const request = ++sequence;
    const latest = () => current(ticket) && sequence === request;
    publish({ reading: true, ...(explicit ? { loaded: false } : {}) });
    try {
      const result = parseProjectHistory(await api.runs(workspace as string), workspace as string);
      if (!latest()) return;
      publish({
        ...result,
        loaded: true,
        readError: "",
        receivedAt: new Date().toISOString(),
        ...(explicit ? { creationUncertain: false } : {}),
      });
    } catch {
      if (latest())
        publish({
          loaded: false,
          readError: t("Run status could not be refreshed. Displayed results may be out of date."),
        });
    } finally {
      if (latest()) {
        publish({ reading: false });
        schedule(ticket);
      }
    }
  }
  async function write(
    kind: "start" | "stop" | "clear",
    action: (ticket: number) => Promise<void>,
  ) {
    const ticket = epoch;
    if (!current(ticket) || !api.canRun || state.pending) return;
    if (
      kind === "start" &&
      (!state.loaded || state.creationUncertain || state.runs.some(isActiveRun))
    )
      return;
    cancelTimer();
    ++sequence;
    publish({ pending: true, reading: false, actionError: "" });
    try {
      await action(ticket);
    } catch (error) {
      if (current(ticket)) {
        const message = error instanceof Error ? error.message : "";
        const uncertain =
          kind === "start" &&
          [
            "task_request_timed_out",
            "Host disconnected before the control request completed",
            "task_response_invalid",
            "task_directory_unconfirmed",
          ].includes(message);
        publish({
          actionError: taskError(error),
          creationUncertain: state.creationUncertain || uncertain,
        });
      }
    } finally {
      if (current(ticket)) {
        await read(ticket, false);
        if (current(ticket)) {
          publish({ pending: false });
          schedule(ticket);
        }
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
      cancelTimer();
      active = true;
      ++epoch;
      ++sequence;
      state = initial();
      publish({});
      void read(epoch, false);
    },
    dispose() {
      active = false;
      ++epoch;
      ++sequence;
      cancelTimer();
    },
    async refresh() {
      if (!current(epoch) || state.pending) return;
      cancelTimer();
      publish({ actionError: "" });
      await read(epoch, true);
    },
    dismissActionError() {
      if (current(epoch)) publish({ actionError: "" });
    },
    start(name: string, fingerprint: string, directory: string) {
      return write("start", async (ticket) => {
        const response = (await api.start(workspace as string, name, fingerprint, directory)) as {
          run?: unknown;
        } | null;
        if (!current(ticket)) return;
        const run = parseProjectRun(response?.run, workspace as string);
        if (run.historical) throw new Error("task_response_invalid");
        if (
          (directory && run.directory !== directory) ||
          (run.directory !== undefined && run.directory !== directory)
        )
          throw new Error("task_directory_unconfirmed");
        if (run.fingerprint !== undefined && run.fingerprint !== fingerprint)
          throw new Error("task_response_invalid");
        publish({
          runs: [run, ...state.runs.filter((item) => item.id !== run.id)],
          receivedAt: new Date().toISOString(),
        });
      });
    },
    stop(id: string) {
      if (!state.runs.some((run) => run.id === id && isActiveRun(run))) return Promise.resolve();
      return write("stop", async () => {
        await api.stop(workspace as string, id);
      });
    },
    clearHistory() {
      if (!api.clearHistory) return Promise.resolve();
      return write("clear", async () => {
        await api.clearHistory?.(workspace as string);
      });
    },
  };
}
