import { create } from "zustand";
import { t } from "../../shared/i18n.js";
import { localizeHostError } from "../../shared/hostErrors.js";
// @ts-expect-error plain JS module without type declarations
import { markTaskAnswered, markTaskCancelled, markTaskForDispatch, markTaskPaused, normalizeSuperAgentTasks } from "../../../../public/super-agent/task-state.js";
import { childTarget, type SuperAgentTask, type TaskFilter } from "./logic";
import { isScheduledTemplate, nextTaskRunAt } from "./logic";

export interface TaskCenterOptions {
  call: (
    operation: string,
    params?: unknown,
  ) => Promise<{
    ok?: boolean;
    error?: string;
    data?: {
      tasks?: unknown[];
      projects?: Array<{ cwd?: string; path?: string }>;
    };
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
  schedulerIntervalMs?: number;
}

export interface TaskDraft {
  title: string;
  description: string;
  targetProject: string;
  schedule: "manual" | "interval" | "daily";
  intervalMinutes?: number | null;
  dailyTime?: string | null;
  requireApproval?: boolean;
  maxRetries?: number;
}

interface TaskCenterState {
  tasks: SuperAgentTask[];
  filter: TaskFilter;
  loading: boolean;
  loadedOnce: boolean;
  error: Error | null;
  openApp(pluginId: string): void;
  setFilter(filter: TaskFilter): void;
  load(options?: { quiet?: boolean }): Promise<void>;
  listProjects(): Promise<string[]>;
  createTask(draft: TaskDraft): Promise<void>;
  updateTaskMeta(
    taskId: string,
    patch: Partial<TaskDraft> & { enabled?: boolean },
  ): Promise<void>;
  runTaskNow(task: SuperAgentTask): Promise<void>;
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
  tick(): Promise<void>;
  startPolling(): void;
  stopPolling(): void;
  startScheduler(): void;
  stopScheduler(): void;
  destroy(): void;
}

export function createTaskCenterStore(options: TaskCenterOptions) {
  const call = options.call;
  const runtime = options.runtime;
  const cancelRuntimeUi = options.cancelRuntimeUi;
  const notify = options.notify ?? (() => {});
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const schedulerIntervalMs = options.schedulerIntervalMs ?? 60_000;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let schedulerTimer: ReturnType<typeof setInterval> | null = null;
  let runtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let tickRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let runtimeRetryAttempts = 0;
  let ticking = false;
  let inFlightLoad: Promise<void> | null = null;
  const runtimeRetryDelays = [1200, 2000, 3000, 5000, 8000, 12000];

  return create<TaskCenterState>()((set, get) => ({
    tasks: [],
    filter: "all",
    loading: false,
    loadedOnce: false,
    error: null,

    openApp(pluginId) {
      options.openApp?.(pluginId);
    },

    setFilter(filter) {
      set({ filter });
    },

    async listProjects() {
      if (typeof call !== "function") return [];
      const paths = new Set<string>();
      try {
        const response = await call("list_super_agent_projects");
        for (const project of response?.data?.projects ?? []) {
          const path = String(project?.cwd || project?.path || "").trim();
          if (path) paths.add(path);
        }
      } catch {
        // Fall through to task-derived suggestions.
      }
      try {
        const tasksResponse = await call("read_super_agent_tasks");
        for (const task of tasksResponse?.data?.tasks ?? []) {
          const path = String(
            (task as { targetProject?: unknown })?.targetProject || "",
          ).trim();
          if (path) paths.add(path);
        }
      } catch {
        // Suggestions are best-effort.
      }
      return [...paths];
    },

    async load({ quiet = false } = {}) {
      if (typeof call !== "function") return;
      // Concurrent callers (polling + scheduler boot) wait for the in-flight
      // load instead of skipping it, so the scheduler never ticks against an
      // empty store right after the app opens.
      if (inFlightLoad) return inFlightLoad;
      inFlightLoad = (async () => {
        set({ loading: true });
        if (!quiet) set({});
        try {
          const response = await call("read_super_agent_tasks");
          if (!response?.ok) throw new Error(t("Task service is unavailable"));
          const tasks = normalizeSuperAgentTasks(
            response.data?.tasks ?? [],
          ) as SuperAgentTask[];
          set({ tasks, error: null, loadedOnce: true });
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
      })();
      try {
        return await inFlightLoad;
      } finally {
        inFlightLoad = null;
      }
    },

    async createTask(draft) {
      const title = String(draft.title || "").trim();
      if (!title) {
        notify({ title: t("Task title is required"), type: "error" });
        return;
      }
      const now = new Date().toISOString();
      const scheduled = draft.schedule !== "manual";
      const template = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        description: String(draft.description || "").trim(),
        targetProject: String(draft.targetProject || "").trim() || null,
        status: "pending",
        source: { channel: "local", conversationId: null, userId: null, messageId: null },
        automation: {
          workflowId: null,
          trigger: scheduled ? "schedule" : "manual",
          autoDispatch: scheduled ? false : !draft.requireApproval,
        },
        schedule: scheduled ? draft.schedule : null,
        intervalMinutes: draft.schedule === "interval" ? draft.intervalMinutes : null,
        dailyTime: draft.schedule === "daily" ? draft.dailyTime : null,
        nextRunAt: scheduled ? nextTaskRunAt({ schedule: draft.schedule, intervalMinutes: draft.intervalMinutes, dailyTime: draft.dailyTime }) : null,
        enabled: scheduled ? true : undefined,
        requireApproval: Boolean(draft.requireApproval),
        budget: null,
        maxRetries: Number.isFinite(Number(draft.maxRetries)) ? Number(draft.maxRetries) : 2,
        retryCount: 0,
        events: [
          {
            at: now,
            type: "queued",
            status: "pending",
            message: scheduled ? t("Scheduled task created.") : t("Task created."),
          },
        ],
      };
      try {
        const response = await call("write_super_agent_tasks", {
          tasks: [...get().tasks, template],
        });
        if (!response?.ok) throw new Error(response?.error || t("Could not create task"));
        set({ tasks: normalizeSuperAgentTasks([...get().tasks, template]) as SuperAgentTask[] });
        notify({
          title: scheduled ? t("Scheduled task created") : t("Task created"),
          type: "success",
        });
      } catch (reason) {
        notify({
          title: t("Could not create task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async updateTaskMeta(taskId, patch) {
      const index = get().tasks.findIndex((task) => task.id === taskId);
      if (index < 0) return;
      const current = get().tasks[index];
      const schedule = patch.schedule ?? current.schedule ?? "manual";
      const scheduled = schedule !== "manual";
      const scheduleFields: Pick<
        SuperAgentTask,
        "schedule" | "intervalMinutes" | "dailyTime"
      > = {
        schedule: scheduled ? schedule : null,
        intervalMinutes:
          schedule === "interval"
            ? (patch.intervalMinutes ?? current.intervalMinutes ?? 60)
            : null,
        dailyTime:
          schedule === "daily" ? (patch.dailyTime ?? current.dailyTime ?? "09:00") : null,
      };
      const next = {
        ...current,
        title: patch.title !== undefined ? String(patch.title).trim() : current.title,
        description:
          patch.description !== undefined
            ? String(patch.description).trim()
            : current.description,
        targetProject:
          patch.targetProject !== undefined
            ? String(patch.targetProject).trim() || null
            : current.targetProject,
        schedule: scheduled ? schedule : null,
        intervalMinutes: scheduleFields.intervalMinutes,
        dailyTime: scheduleFields.dailyTime,
        requireApproval:
          patch.requireApproval !== undefined
            ? Boolean(patch.requireApproval)
            : current.requireApproval,
        enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
        maxRetries:
          patch.maxRetries !== undefined
            ? Number.isFinite(Number(patch.maxRetries))
              ? Number(patch.maxRetries)
              : current.maxRetries
            : current.maxRetries,
        automation: {
          ...(current.automation || {}),
          trigger: scheduled ? "schedule" : "manual",
          autoDispatch: scheduled ? false : !(patch.requireApproval ?? current.requireApproval),
        },
        nextRunAt: scheduled ? nextTaskRunAt(scheduleFields) : null,
      };
      const tasks = [...get().tasks];
      tasks[index] = next;
      try {
        const response = await call("write_super_agent_tasks", { tasks });
        if (!response?.ok) throw new Error(response?.error || t("Could not update task"));
        set({ tasks: normalizeSuperAgentTasks(tasks) as SuperAgentTask[] });
        notify({ title: t("Task updated"), type: "success" });
      } catch (reason) {
        notify({
          title: t("Could not update task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async runTaskNow(task) {
      if (!isScheduledTemplate(task)) return;
      const timestamp = new Date().toISOString();
      const instance = {
        ...task,
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        schedule: null,
        intervalMinutes: null,
        dailyTime: null,
        nextRunAt: null,
        scheduledFrom: task.id,
        enabled: true,
        status: "pending",
        retryCount: 0,
        failReason: null,
        result: { status: null, summary: null, completedAt: null, failReason: null },
        automation: {
          ...(task.automation || {}),
          trigger: "manual",
          autoDispatch: !task.requireApproval,
        },
        events: [
          {
            at: timestamp,
            type: "queued",
            status: "pending",
            message: t("Created by running the scheduled task now."),
          },
        ],
      };
      const tasks = [...get().tasks, instance];
      try {
        const response = await call("write_super_agent_tasks", { tasks });
        if (!response?.ok) throw new Error(response?.error || t("Could not run task"));
        set({ tasks: normalizeSuperAgentTasks(tasks) as SuperAgentTask[] });
        notify({ title: t("Task queued and running"), type: "success" });
      } catch (reason) {
        notify({
          title: t("Could not run task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
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

    async tick() {
      if (ticking || typeof call !== "function") return;
      ticking = true;
      try {
        // The scheduler can boot before the first poll completes; wait for
        // the task list so a due template is caught immediately instead of
        // on the next interval tick.
        if (!get().loadedOnce) {
          await get().load({ quiet: true });
          if (!get().loadedOnce) {
            // The first read failed (e.g. the runtime was still booting).
            // The store's readiness retry reloads shortly; re-check soon
            // instead of waiting a full scheduler interval.
            if (!tickRetryTimer) {
              tickRetryTimer = setTimeout(() => {
                tickRetryTimer = null;
                void get().tick();
              }, 2000);
            }
            return;
          }
        }
        const tasks = [...get().tasks];
        const now = Date.now();
        let changed = false;
        for (let index = 0; index < tasks.length; index += 1) {
          const template = tasks[index];
          if (!isScheduledTemplate(template) || template.enabled === false) continue;
          if (!template.nextRunAt || new Date(template.nextRunAt).getTime() > now) continue;
          const timestamp = new Date().toISOString();
          const instance = {
            ...template,
            id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            schedule: null,
            intervalMinutes: null,
            dailyTime: null,
            nextRunAt: null,
            scheduledFrom: template.id,
            enabled: true,
            status: "pending",
            retryCount: 0,
            failReason: null,
            result: { status: null, summary: null, completedAt: null, failReason: null },
            automation: {
              ...(template.automation || {}),
              trigger: "schedule",
              autoDispatch: !template.requireApproval,
            },
            events: [
              {
                at: timestamp,
                type: "queued",
                status: "pending",
                message: t("Created by the scheduled task."),
              },
            ],
          };
          tasks[index] = {
            ...template,
            nextRunAt: nextTaskRunAt(template),
          };
          tasks.push(instance);
          changed = true;
        }
        if (!changed) return;
        const response = await call("write_super_agent_tasks", { tasks });
        if (response?.ok) {
          set({ tasks: normalizeSuperAgentTasks(tasks) as SuperAgentTask[] });
        }
      } finally {
        ticking = false;
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

    startScheduler() {
      if (schedulerTimer) return;
      schedulerTimer = setInterval(() => void get().tick(), schedulerIntervalMs);
      void get().tick();
    },

    stopScheduler() {
      if (schedulerTimer) clearInterval(schedulerTimer);
      schedulerTimer = null;
      if (tickRetryTimer) clearTimeout(tickRetryTimer);
      tickRetryTimer = null;
    },

    destroy() {
      get().stopPolling();
      get().stopScheduler();
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
