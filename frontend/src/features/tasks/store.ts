import { create } from "zustand";
import { t } from "../../shared/i18n.js";
import { localizeHostError } from "../../shared/hostErrors.js";
// @ts-expect-error plain JS module without type declarations
import { markTaskAnswered, markTaskCancelled, markTaskForDispatch, markTaskPaused, normalizeSuperAgentTasks } from "../../../../public/super-agent/task-state.js";
import { childTarget, type SuperAgentTask, type TaskFilter } from "./logic";

export interface TaskCenterOptions {
  call: (
    operation: string,
    params?: unknown,
  ) => Promise<{
    ok?: boolean;
    error?: string;
    data?: { tasks?: unknown[] };
  }>;
  runtime?: {
    request?: (
      message: unknown,
      target: unknown,
      options?: { idempotencyKey?: string },
    ) => Promise<unknown>;
  };
  cancelRuntimeUi?: (target: unknown) => Promise<void>;
  openApp?: (pluginId: string) => void;
  notify?: (payload: { title: string; message?: string; type?: string }) => void;
  pollIntervalMs?: number;
}

interface TaskCenterState {
  tasks: SuperAgentTask[];
  filter: TaskFilter;
  loading: boolean;
  error: Error | null;
  openApp(pluginId: string): void;
  setFilter(filter: TaskFilter): void;
  load(options?: { quiet?: boolean }): Promise<void>;
  updateTask(
    taskId: string,
    updater: (task: SuperAgentTask) => SuperAgentTask,
    successMessage?: string,
  ): Promise<void>;
  removeTask(taskId: string): Promise<void>;
  clearDoneTasks(): Promise<void>;
  answerTask(task: SuperAgentTask, answer: string): Promise<void>;
  approveTask(task: SuperAgentTask): Promise<void>;
  retryAndRunTask(task: SuperAgentTask): Promise<void>;
  pauseTask(task: SuperAgentTask): Promise<void>;
  cancelTask(task: SuperAgentTask): Promise<void>;
  startPolling(): void;
  stopPolling(): void;
  destroy(): void;
}

export function createTaskCenterStore(options: TaskCenterOptions) {
  const call = options.call;
  const runtime = options.runtime;
  const cancelRuntimeUi = options.cancelRuntimeUi;
  const notify = options.notify ?? (() => {});
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let runtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let runtimeRetryAttempts = 0;
  const runtimeRetryDelays = [1200, 2000, 3000, 5000, 8000, 12000];

  return create<TaskCenterState>()((set, get) => ({
    tasks: [],
    filter: "all",
    loading: false,
    error: null,

    openApp(pluginId) {
      options.openApp?.(pluginId);
    },

    setFilter(filter) {
      set({ filter });
    },

    async load({ quiet = false } = {}) {
      if (get().loading || typeof call !== "function") return;
      set({ loading: true });
      if (!quiet) set({});
      try {
        const response = await call("read_super_agent_tasks");
        if (!response?.ok) throw new Error(t("Task service is unavailable"));
        const tasks = normalizeSuperAgentTasks(response.data?.tasks ?? []) as SuperAgentTask[];
        set({ tasks, error: null });
        runtimeRetryAttempts = 0;
      } catch (reason) {
        const raw = reason instanceof Error ? reason.message : String(reason);
        set({
          error: localizeHostError(
            reason instanceof Error ? reason : new Error(String(reason)),
          ),
        });
        // A fresh session can race runtime readiness: the first load fails
        // with "unknown instance" before the runtime finishes booting. Retry
        // automatically with backoff so the user does not have to notice and
        // click "Retry" on an empty error state.
        if (
          !runtimeRetryTimer &&
          /unknown_instance|UnknownInstance|runtime unavailable/i.test(raw)
        ) {
          const delay =
            runtimeRetryDelays[
              Math.min(runtimeRetryAttempts, runtimeRetryDelays.length - 1)
            ] ?? 1200;
          runtimeRetryAttempts += 1;
          runtimeRetryTimer = setTimeout(() => {
            runtimeRetryTimer = null;
            void get().load({ quiet: true });
          }, delay);
        }
      } finally {
        set({ loading: false });
      }
    },

    async updateTask(taskId, updater, successMessage) {
      const index = get().tasks.findIndex((task) => task.id === taskId);
      if (index < 0) return;
      const next = [...get().tasks];
      next[index] = updater(next[index]);
      try {
        const response = await call("write_super_agent_tasks", { tasks: next });
        if (!response?.ok) throw new Error(t("Could not update task"));
        set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[] });
        if (successMessage) notify({ title: successMessage, type: "success" });
      } catch (reason) {
        notify({
          title: t("Could not update task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async removeTask(taskId) {
      const next = get().tasks.filter((task) => task.id !== taskId);
      try {
        const response = await call("write_super_agent_tasks", { tasks: next });
        if (!response?.ok) throw new Error(t("Could not update task"));
        set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[] });
      } catch (reason) {
        notify({
          title: t("Could not update task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async clearDoneTasks() {
      const doneIds = new Set(
        get()
          .tasks.filter((task) => task.status === "done")
          .map((task) => task.id),
      );
      if (doneIds.size === 0) return;
      const next = get().tasks.filter((task) => !doneIds.has(task.id));
      try {
        const response = await call("write_super_agent_tasks", { tasks: next });
        if (!response?.ok) throw new Error(t("Could not update task"));
        set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[] });
        notify({ title: t("Cleared completed tasks"), type: "success" });
      } catch (reason) {
        notify({
          title: t("Could not update task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async answerTask(task, answer) {
      const text = String(answer || "").trim();
      if (!text) return;
      const target = childTarget(task);
      if (!target) {
        notify({
          title: t("Task cannot be answered"),
          message: t("The task is not attached to a running session yet."),
          type: "warning",
        });
        return;
      }
      try {
        if (runtime?.request) {
          await runtime.request(
            { type: "prompt", message: text },
            target,
            { idempotencyKey: `answer-${task.id}-${Date.now()}` },
          );
        }
        await get().updateTask(
          task.id,
          (current) => markTaskAnswered(current),
          t("Answer sent to the project agent."),
        );
      } catch (reason) {
        notify({
          title: t("Could not send the answer"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async approveTask(task) {
      const index = get().tasks.findIndex((candidate) => candidate.id === task.id);
      if (index < 0) return;
      const next = [...get().tasks];
      next[index] = markTaskForDispatch(next[index]);
      try {
        const response = await call("write_super_agent_tasks", { tasks: next });
        if (!response?.ok) throw new Error(t("Could not approve task"));
        set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[] });
        // Same path as the Agent Inbox runtime panel: the host listens for
        // sa-dispatch and hands the task to a project agent.
        document.dispatchEvent(
          new CustomEvent("sa-dispatch", { detail: next[index], bubbles: true }),
        );
        notify({ title: t("Task approved and dispatched"), type: "success" });
      } catch (reason) {
        notify({
          title: t("Could not approve task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async retryAndRunTask(task) {
      const index = get().tasks.findIndex((candidate) => candidate.id === task.id);
      if (index < 0) return;
      const next = [...get().tasks];
      const reset = {
        ...next[index],
        status: "pending",
        retryCount: Number(next[index].retryCount || 0) + 1,
        result: { status: null, summary: null, completedAt: null, failReason: null },
        failReason: null,
      };
      next[index] = markTaskForDispatch(reset);
      try {
        const response = await call("write_super_agent_tasks", { tasks: next });
        if (!response?.ok) throw new Error(t("Could not update task"));
        set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[] });
        // Same path as approveTask: the host listens for sa-dispatch and hands
        // the task to a project agent in one step.
        document.dispatchEvent(
          new CustomEvent("sa-dispatch", { detail: next[index], bubbles: true }),
        );
        notify({ title: t("Task retried and dispatched"), type: "success" });
      } catch (reason) {
        notify({
          title: t("Could not update task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async pauseTask(task) {
      try {
        await stopTaskRuntime(task, { runtime, cancelRuntimeUi });
        await get().updateTask(task.id, (current) => markTaskPaused(current), t("Task paused"));
      } catch (reason) {
        notify({
          title: t("Could not pause task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async cancelTask(task) {
      try {
        await stopTaskRuntime(task, { runtime, cancelRuntimeUi });
        await get().updateTask(
          task.id,
          (current) => markTaskCancelled(current),
          t("Task cancelled"),
        );
      } catch (reason) {
        notify({
          title: t("Could not cancel task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    startPolling() {
      get().stopPolling();
      pollTimer = setInterval(() => void get().load({ quiet: true }), pollIntervalMs);
      void get().load({ quiet: true });
    },

    stopPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },

    destroy() {
      get().stopPolling();
    },
  }));
}

async function stopTaskRuntime(
  task: SuperAgentTask,
  options: Pick<TaskCenterOptions, "runtime" | "cancelRuntimeUi">,
) {
  const target = childTarget(task);
  if (!target) {
    if (task.status === "running") {
      throw new Error(
        t("The running task has not published a controllable session yet."),
      );
    }
    return;
  }
  if (!options.runtime?.request) throw new Error(t("Runtime control is unavailable"));
  await options.runtime.request({ type: "abort" }, target);
  await options.cancelRuntimeUi?.(target);
}
