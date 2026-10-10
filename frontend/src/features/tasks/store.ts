import { create } from "zustand";
// @ts-expect-error native shared module without declarations
import { taskWriteParams } from "../../../../public/super-agent/task-persistence.js";
// @ts-expect-error plain JS module without type declarations
import { markTaskAnswered, markTaskCancelled, markTaskForDispatch, markTaskPaused, normalizeSuperAgentTasks } from "../../../../public/super-agent/task-state.js";
import { localizeHostError } from "../../shared/hostErrors.js";
import { t } from "../../shared/i18n.js";
import type { WorkCreationRequest } from "../../shared/workCreation";
import { approveExistingTask, sameTaskTarget, type TaskCenterTarget } from "./approve-task";
import { createTaskWriter } from "./create-task";
import { childTarget, isScheduledTemplate, type SuperAgentTask, type TaskFilter } from "./logic";
import { taskMetadata } from "./task-metadata";

export interface TaskCenterOptions {
  call: (
    operation: string,
    params?: unknown,
    options?: { target?: unknown },
  ) => Promise<{
    ok?: boolean;
    error?: string;
    data?: {
      tasks?: unknown[];
      revision?: string;
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
  getCurrentProjectPath?: () => string | null;
  getTarget?: () => TaskCenterTarget | null;
  pollIntervalMs?: number;
  schedulerIntervalMs?: number;
}

export interface TaskDraft {
  saveAsDraft?: boolean;
  title: string;
  description: string;
  targetProject: string;
  schedule: "manual" | "interval" | "daily";
  intervalMinutes?: number | null;
  dailyTime?: string | null;
  requireApproval?: boolean;
  maxRetries?: number;
}

interface TaskMutationScope {
  epoch: number;
  target: TaskCenterTarget | null;
  tasks: SuperAgentTask[];
  revision?: string;
}

interface TaskCenterState {
  tasks: SuperAgentTask[];
  revision?: string;
  filter: TaskFilter;
  focusTaskId: string | null;
  creationRequest: WorkCreationRequest | null;
  requestCreation(projectPath: string): void;
  clearCreation(): void;
  loading: boolean;
  loadedOnce: boolean;
  error: Error | null;
  openApp(pluginId: string): void;
  setFilter(filter: TaskFilter): void;
  focusTask(taskId: string | null): void;
  syncTarget(): void;
  load(options?: { quiet?: boolean }): Promise<void>;
  listProjects(): Promise<string[]>;
  createTask(draft: TaskDraft): Promise<boolean>;
  rerunTask(task: SuperAgentTask): Promise<void>;
  updateTaskMeta(
    taskId: string,
    patch: Partial<TaskDraft> & { enabled?: boolean },
  ): Promise<boolean>;
  runTaskNow(task: SuperAgentTask): Promise<void>;
  updateTask(
    taskId: string,
    updater: (task: SuperAgentTask) => SuperAgentTask,
    successMessage?: string,
    scope?: TaskMutationScope,
  ): Promise<void>;
  togglePinned(taskId: string): Promise<void>;
  toggleArchived(taskId: string): Promise<void>;
  removeTask(taskId: string): Promise<void>;
  clearDoneTasks(): Promise<void>;
  answerTask(task: SuperAgentTask, answer: string): Promise<void>;
  approveTask(task: SuperAgentTask): Promise<boolean>;
  approveTaskById(taskId: string, target?: TaskCenterTarget | null): Promise<boolean>;
  retryAndRunTask(task: SuperAgentTask): Promise<void>;
  pauseTask(task: SuperAgentTask): Promise<void>;
  cancelTask(task: SuperAgentTask): Promise<void>;
  tick(): Promise<void>;
  startPolling(): void;
  stopPolling(): void;
  startScheduler(): void;
  stopScheduler(): void;
  destroy(): void;
  getCurrentProjectPath(): string | null;
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
  let runtimeRetryAttempts = 0;
  let ticking = false;
  let creationSequence = 0;
  let inFlightLoad: Promise<void> | null = null;
  let scopeTarget = options.getTarget?.() ?? null;
  let scopeEpoch = 0;
  let tickRequested = false;
  const runtimeRetryDelays = [1200, 2000, 3000, 5000, 8000, 12000];
  const mutationScope = (tasks: SuperAgentTask[], revision?: string): TaskMutationScope => ({
    epoch: scopeEpoch,
    target: scopeTarget,
    tasks,
    revision,
  });
  const writeForScope = (tasks: SuperAgentTask[], scope: TaskMutationScope) => {
    if (options.getTarget && !scope.target) throw new Error(t("Task service is unavailable"));
    return call("write_super_agent_tasks", taskWriteParams(tasks, scope.revision), scope.target ? { target: scope.target } : undefined);
  };

  return create<TaskCenterState>()((set, get) => ({
    tasks: [],
    filter: "all",
    focusTaskId: null,
    creationRequest: null,
    requestCreation(projectPath) {
      set({ creationRequest: { sequence: ++creationSequence, projectPath }, focusTaskId: null, filter: "all" });
    },
    clearCreation() { set({ creationRequest: null }); },
    loading: false,
    loadedOnce: false,
    error: null,

    getCurrentProjectPath() {
      return options.getCurrentProjectPath?.() ?? null;
    },

    openApp(pluginId) {
      options.openApp?.(pluginId);
    },

    setFilter(filter) {
      set({ filter });
    },

    focusTask(taskId) {
      set((state) => ({
        focusTaskId: taskId,
        filter: taskId ? "all" : state.filter,
      }));
    },

    syncTarget() {
      const nextTarget = options.getTarget?.() ?? null;
      if (sameTaskTarget(scopeTarget, nextTarget)) return;
      scopeTarget = nextTarget;
      scopeEpoch += 1;
      inFlightLoad = null;
      runtimeRetryAttempts = 0;
      if (runtimeRetryTimer) clearTimeout(runtimeRetryTimer);
      runtimeRetryTimer = null;
      set({ tasks: [], revision: undefined, loadedOnce: false, loading: false, error: null, focusTaskId: null, creationRequest: null });
      if (pollTimer || schedulerTimer) void get().load({ quiet: true });
      if (schedulerTimer) {
        if (ticking) tickRequested = true;
        else void get().tick();
      }
    },

    async listProjects() {
      if (typeof call !== "function") return [];
      const epoch = scopeEpoch;
      const target = scopeTarget;
      if (options.getTarget && !target) return [];
      const fixedCall = (operation: string) => call(operation, undefined, target ? { target } : undefined);
      const paths = new Set<string>();
      try {
        const response = await fixedCall("list_super_agent_projects");
        if (epoch !== scopeEpoch) return [];
        for (const project of response?.data?.projects ?? []) {
          const path = String(project?.cwd || project?.path || "").trim();
          if (path) paths.add(path);
        }
      } catch {
        // Fall through to task-derived suggestions.
      }
      try {
        const tasksResponse = await fixedCall("read_super_agent_tasks");
        if (epoch !== scopeEpoch) return [];
        for (const task of tasksResponse?.data?.tasks ?? []) {
          const path = String(
            (task as { targetProject?: unknown })?.targetProject || "",
          ).trim();
          if (path) paths.add(path);
        }
      } catch {
        // Suggestions are best-effort.
      }
      return epoch === scopeEpoch ? [...paths] : [];
    },

    async load({ quiet = false } = {}) {
      if (typeof call !== "function") return;
      const epoch = scopeEpoch;
      const target = scopeTarget;
      if (options.getTarget && !target) return;
      // Concurrent refresh callers share the in-flight read during app startup.
      if (inFlightLoad) return inFlightLoad;
      const request = (async () => {
        set({ loading: true });
        if (!quiet) set({});
        try {
          const response = await call("read_super_agent_tasks", undefined, target ? { target } : undefined);
          if (epoch !== scopeEpoch) return;
          if (!response?.ok || !Array.isArray(response.data?.tasks)) throw new Error(response?.error || t("Task service is unavailable"));
          const tasks = normalizeSuperAgentTasks(
            response.data?.tasks ?? [],
          ) as SuperAgentTask[];
          set({ tasks, revision: response.data?.revision, error: null, loadedOnce: true });
          runtimeRetryAttempts = 0;
          if (runtimeRetryTimer) clearTimeout(runtimeRetryTimer);
          runtimeRetryTimer = null;
        } catch (reason) {
          if (epoch !== scopeEpoch) return;
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
          if (epoch === scopeEpoch) set({ loading: false });
        }
      })();
      inFlightLoad = request;
      try {
        return await request;
      } finally {
        if (inFlightLoad === request) inFlightLoad = null;
      }
    },

    createTask: createTaskWriter({
      call,
      scopeToken: () => scopeEpoch,
      isScopeCurrent: (token) => token === scopeEpoch,
      async readCurrent() {
        const epoch = scopeEpoch;
        const target = scopeTarget;
        if (options.getTarget && !target) throw new Error(t("Task service is unavailable"));
        await get().load({ quiet: true });
        if (epoch !== scopeEpoch) throw new Error(t("Workspace changed. Retry the task action."));
        if (!get().loadedOnce || get().error) throw new Error(t("Refresh the task list successfully before creating a task."));
        return { tasks: get().tasks, revision: get().revision, target };
      },
      publish(task, revision) {
        set({ tasks: normalizeSuperAgentTasks([...get().tasks.filter((item) => item.id !== task.id), task]) as SuperAgentTask[], revision });
      },
      notify,
    }),

    async rerunTask(task) {
      if (task?.status === "draft") return;
      const title = String(task?.title || "").trim();
      if (!title) {
        notify({ title: t("Task title is required"), type: "error" });
        return;
      }
      await get().createTask({
        title,
        description: String(task?.description || "").trim(),
        targetProject: String(task?.targetProject || "").trim(),
        schedule: "manual",
        requireApproval: Boolean(task?.requireApproval),
        maxRetries: Number(task?.maxRetries ?? 2),
      });
    },

    async updateTaskMeta(taskId, patch) {
      try {
        const scope = mutationScope(get().tasks, get().revision);
        const index = get().tasks.findIndex((task) => task.id === taskId);
        if (index < 0) throw new Error(t("The selected task is no longer available."));
        const tasks = [...get().tasks];
        tasks[index] = taskMetadata(tasks[index], patch);
        const response = await writeForScope(tasks, scope);
        if (!response?.ok) throw new Error(response?.error || t("Could not update task"));
        if (scope.epoch === scopeEpoch) set({ tasks: normalizeSuperAgentTasks(tasks) as SuperAgentTask[], revision: response.data?.revision });
        notify({ title: tasks[index].status === "draft" ? t("Task draft saved") : t("Task updated"), type: "success" });
        return true;
      } catch (reason) {
        notify({ title: t("Could not update task"), message: localizeHostError(reason).message, type: "error" });
        return false;
      }
    },

    async runTaskNow(task) {
      if (!isScheduledTemplate(task)) return;
      const scope = mutationScope(get().tasks, get().revision);
      const currentTemplate = scope.tasks.find((item) => item.id === task.id);
      if (!currentTemplate || !isScheduledTemplate(currentTemplate)) return;
      task = currentTemplate;
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
        const response = await writeForScope(tasks, scope);
        if (!response?.ok) throw new Error(response?.error || t("Could not run task"));
        if (scope.epoch === scopeEpoch) set({ tasks: normalizeSuperAgentTasks(tasks) as SuperAgentTask[], revision: response.data?.revision });
        notify({ title: t("Task queued and running"), type: "success" });
      } catch (reason) {
        notify({
          title: t("Could not run task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async updateTask(taskId, updater, successMessage, suppliedScope) {
      const scope = suppliedScope ?? mutationScope(get().tasks, get().revision);
      const index = scope.tasks.findIndex((task) => task.id === taskId);
      if (index < 0) return;
      const next = [...scope.tasks];
      next[index] = updater(next[index]);
      try {
        const response = await writeForScope(next, scope);
        if (!response?.ok) throw new Error(response?.error || t("Could not update task"));
        if (scope.epoch === scopeEpoch) set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[], revision: response.data?.revision });
        if (successMessage) notify({ title: successMessage, type: "success" });
      } catch (reason) {
        notify({
          title: t("Could not update task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async togglePinned(taskId) {
      const task = get().tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      const pinning = !Boolean(task.pinned);
      await get().updateTask(
        taskId,
        (current) => ({ ...current, pinned: pinning }),
        pinning ? t("Task pinned") : t("Task unpinned"),
      );
    },

    async toggleArchived(taskId) {
      const task = get().tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      const archiving = !Boolean(task.archived);
      await get().updateTask(
        taskId,
        (current) => ({ ...current, archived: archiving }),
        archiving ? t("Task archived") : t("Task restored"),
      );
    },

    async removeTask(taskId) {
      const scope = mutationScope(get().tasks, get().revision);
      if (!scope.tasks.some((task) => task.id === taskId)) return;
      const next = scope.tasks.filter((task) => task.id !== taskId);
      try {
        const response = await writeForScope(next, scope);
        if (!response?.ok) throw new Error(response?.error || t("Could not update task"));
        if (scope.epoch === scopeEpoch) set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[], revision: response.data?.revision });
      } catch (reason) {
        notify({
          title: t("Could not update task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async clearDoneTasks() {
      const scope = mutationScope(get().tasks, get().revision);
      const doneIds = new Set(
        scope.tasks.filter((task) => task.status === "done")
          .map((task) => task.id),
      );
      if (doneIds.size === 0) return;
      const next = scope.tasks.filter((task) => !doneIds.has(task.id));
      try {
        const response = await writeForScope(next, scope);
        if (!response?.ok) throw new Error(response?.error || t("Could not update task"));
        if (scope.epoch === scopeEpoch) set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[], revision: response.data?.revision });
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
      const scope = mutationScope(get().tasks, get().revision);
      if (!scope.tasks.some((current) => current.id === task.id)) return;
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
          scope,
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
      return get().approveTaskById(task.id);
    },

    async approveTaskById(taskId, requestedTarget) {
      const sourceTarget = requestedTarget === undefined ? options.getTarget?.() ?? null : requestedTarget;
      if (options.getTarget && !sourceTarget) return false;
      try {
        const approved = await approveExistingTask(call, taskId, sourceTarget);
        if (!options.getTarget || sameTaskTarget(sourceTarget, options.getTarget())) {
          set({ tasks: approved.tasks, revision: approved.revision, error: null });
        }
        // Same path as the Agent Inbox runtime panel: the host listens for
        // sa-dispatch and hands the task to a project agent.
        const event = new CustomEvent("sa-dispatch", { detail: approved.task, bubbles: true }) as CustomEvent & { sourceTarget?: TaskCenterTarget | null };
        event.sourceTarget = sourceTarget;
        document.dispatchEvent(event);
        notify({ title: t("Task approved and dispatched"), type: "success" });
        return true;
      } catch (reason) {
        notify({
          title: t("Could not approve task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
        return false;
      }
    },

    async retryAndRunTask(task) {
      if (task.status === "draft" || get().tasks.find((item) => item.id === task.id)?.status === "draft") return;
      const scope = mutationScope(get().tasks, get().revision);
      const index = get().tasks.findIndex((candidate) => candidate.id === task.id);
      if (index < 0) return;
      const next = [...scope.tasks];
      const reset = {
        ...next[index],
        status: "pending",
        retryCount: Number(next[index].retryCount || 0) + 1,
        result: { status: null, summary: null, completedAt: null, failReason: null },
        failReason: null,
      };
      next[index] = markTaskForDispatch(reset);
      try {
        const response = await writeForScope(next, scope);
        if (!response?.ok) throw new Error(response?.error || t("Could not update task"));
        if (scope.epoch === scopeEpoch) set({ tasks: normalizeSuperAgentTasks(next) as SuperAgentTask[], revision: response.data?.revision });
        // Same path as approveTask: the host listens for sa-dispatch and hands
        // the task to a project agent in one step.
        const event = new CustomEvent("sa-dispatch", { detail: next[index], bubbles: true }) as CustomEvent & { sourceTarget?: TaskCenterTarget | null };
        event.sourceTarget = scope.target;
        document.dispatchEvent(event);
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
      const scope = mutationScope(get().tasks, get().revision);
      if (!scope.tasks.some((current) => current.id === task.id)) return;
      try {
        await stopTaskRuntime(task, { runtime, cancelRuntimeUi });
        await get().updateTask(task.id, (current) => markTaskPaused(current), t("Task paused"), scope);
      } catch (reason) {
        notify({
          title: t("Could not pause task"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async cancelTask(task) {
      const scope = mutationScope(get().tasks, get().revision);
      if (!scope.tasks.some((current) => current.id === task.id)) return;
      try {
        await stopTaskRuntime(task, { runtime, cancelRuntimeUi });
        await get().updateTask(
          task.id,
          (current) => markTaskCancelled(current),
          t("Task cancelled"),
          scope,
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
      const target = scopeTarget;
      if (options.getTarget && !target) return;
      ticking = true;
      try {
        // Host owns template creation; pages only observe the committed state.
        await get().load({ quiet: true });
      } finally {
        ticking = false;
        if (tickRequested && schedulerTimer) {
          tickRequested = false;
          void get().tick();
        }
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
      if (ticking) tickRequested = true;
      else void get().tick();
    },

    stopScheduler() {
      if (schedulerTimer) clearInterval(schedulerTimer);
      schedulerTimer = null;
    },

    destroy() {
      get().stopPolling();
      get().stopScheduler();
      scopeEpoch += 1;
      inFlightLoad = null;
      tickRequested = false;
      if (runtimeRetryTimer) clearTimeout(runtimeRetryTimer);
      runtimeRetryTimer = null;
      runtimeRetryAttempts = 0;
      set({ loading: false });
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
