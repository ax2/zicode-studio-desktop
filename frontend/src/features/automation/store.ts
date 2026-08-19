import { create } from "zustand";
import { t } from "../../shared/i18n.js";
import { isRuntimeProcessClosedError, localizeHostError } from "../../shared/hostErrors.js";
import {
  isAutomationDue,
  nextAutomationRun,
  type AutomationFilter,
  type AutomationWorkflow,
} from "./logic";

export interface AutomationAppOptions {
  call: (
    operation: string,
    params?: unknown,
  ) => Promise<{
    ok?: boolean;
    error?: string;
    data?: {
      workflows?: AutomationWorkflow[];
      workflow?: AutomationWorkflow;
      tasks?: unknown[];
      workspace?: { workflows?: AutomationWorkflow[] };
    };
  }>;
  getTarget?: () => { sceneId?: string; cwd?: string } | null;
  openApp?: (pluginId: string) => void;
  notify?: (payload: { title: string; message?: string; type?: string }) => void;
  confirmRemove?: (message: string) => boolean | Promise<boolean>;
  pollIntervalMs?: number;
  retryDelayMs?: number;
}

interface AutomationState {
  workflows: AutomationWorkflow[];
  filter: AutomationFilter;
  loading: boolean;
  error: Error | null;
  notify(payload: { title: string; message?: string; type?: string }): void;
  getTarget(): { sceneId?: string; cwd?: string } | null;
  setFilter(filter: AutomationFilter): void;
  load(): Promise<AutomationWorkflow[]>;
  saveWorkflow(workflow: AutomationWorkflow): Promise<AutomationWorkflow | undefined>;
  removeWorkflow(id: string): Promise<void>;
  runWorkflow(workflow: AutomationWorkflow, trigger?: string): Promise<void>;
  tick(): Promise<void>;
  startScheduler(): void;
  destroy(): void;
}

export function createAutomationStore(options: AutomationAppOptions) {
  const call = options.call;
  const getTarget = options.getTarget ?? (() => null);
  const notify = options.notify ?? (() => {});
  const confirmRemove =
    options.confirmRemove ??
    ((message: string) => globalThis.confirm?.(message) ?? false);
  const pollIntervalMs = options.pollIntervalMs ?? 60_000;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  return create<AutomationState>()((set, get) => ({
    workflows: [],
    filter: "all",
    loading: false,
    error: null,

    notify(payload) {
      notify(payload);
    },

    getTarget() {
      return getTarget();
    },

    setFilter(filter) {
      set({ filter });
    },

    async load() {
      if (get().loading || typeof call !== "function") return get().workflows;
      set({ loading: true });
      try {
        const workflows = await listWorkflowsWithRetry(call, retryDelayMs);
        set({ workflows, error: null });
        return workflows;
      } catch (reason) {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        set({ error: localizeHostError(error) });
        return get().workflows;
      } finally {
        set({ loading: false });
      }
    },

    async saveWorkflow(workflow) {
      const response = await call("automation_workspace", { action: "upsert", workflow });
      if (!response?.ok) {
        throw localizeHostError(
          new Error(response?.error || t("Could not save automation")),
        );
      }
      const workflows =
        response.data?.workspace?.workflows ?? response.data?.workflows ?? get().workflows;
      set({ workflows });
      return response.data?.workflow;
    },

    async removeWorkflow(id) {
      const workflow = get().workflows.find((candidate) => candidate.id === id);
      if (
        !workflow ||
        !(await confirmRemove(
          `${t("Remove automation")} “${workflow.title}”? ${t(
            "This cannot be undone.",
          )}`,
        ))
      ) {
        return;
      }
      const response = await call("automation_workspace", { action: "remove", id });
      if (!response?.ok) {
        notify({
          title: t("Could not remove automation"),
          message: response?.error
            ? localizeHostError(new Error(response.error)).message
            : undefined,
          type: "error",
        });
        return;
      }
      const workflows = response.data?.workflows ?? get().workflows;
      set({ workflows });
    },

    async runWorkflow(workflow, trigger = "manual") {
      try {
        await enqueue(workflow, trigger, { call, getTarget, notify, set, get });
        await get().load();
      } catch (reason) {
        notify({
          title: t("Could not run automation"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async tick() {
      if (ticking || typeof call !== "function") return;
      ticking = true;
      try {
        const current = await get().load();
        await reconcileRuns(current, { call, getTarget, notify, set, get });
        for (const workflow of current.filter((item) => isAutomationDue(item))) {
          try {
            const now = new Date().toISOString();
            if (workflow.requireApproval) {
              await recordRun(
                workflow,
                {
                  status: "approval_required",
                  startedAt: now,
                  taskId: null,
                  message: t("Waiting for approval"),
                },
                { approvalPending: true, nextRunAt: workflow.nextRunAt || now },
                { call, getTarget, notify, set, get },
              );
              notify({
                title: t("Automation needs approval"),
                message: workflow.title,
                type: "warning",
              });
            } else {
              await enqueue(workflow, "schedule", { call, getTarget, notify, set, get });
            }
          } catch {
            // Keep scheduling the remaining due workflows; a single broken
            // automation must not block every other one indefinitely.
          }
        }
      } catch {
        // Scheduler failures remain visible on the next manual refresh.
      } finally {
        ticking = false;
      }
    },

    startScheduler() {
      if (pollTimer) return;
      pollTimer = setInterval(() => void get().tick(), pollIntervalMs);
      void get().tick();
    },

    destroy() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listWorkflowsWithRetry(
  call: AutomationAppOptions["call"],
  retryDelayMs: number,
): Promise<AutomationWorkflow[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await call("automation_workspace", { action: "list" });
      if (!response?.ok) {
        throw new Error(response?.error || t("Automation service is unavailable"));
      }
      return response.data?.workflows ?? [];
    } catch (reason) {
      lastError = reason;
      if (attempt < 2 && isRuntimeProcessClosedError(reason)) {
        await sleep(retryDelayMs);
        continue;
      }
      throw reason;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface StoreRefs {
  call: AutomationAppOptions["call"];
  getTarget: NonNullable<AutomationAppOptions["getTarget"]>;
  notify: NonNullable<AutomationAppOptions["notify"]>;
  set: (partial: Partial<AutomationState>) => void;
  get: () => AutomationState;
}

async function recordRun(
  workflow: AutomationWorkflow,
  run: { status: string; startedAt: string; taskId: string | null; message?: string },
  { approvalPending = false, nextRunAt }: { approvalPending?: boolean; nextRunAt?: string | null },
  refs: StoreRefs,
) {
  const response = await refs.call("automation_workspace", {
    action: "record_run",
    id: workflow.id,
    run,
    approvalPending,
    nextRunAt: nextRunAt ?? workflow.nextRunAt,
  });
  if (!response?.ok) {
    throw localizeHostError(
      new Error(response?.error || t("Could not update automation history")),
    );
  }
  refs.set({ workflows: response.data?.workspace?.workflows ?? refs.get().workflows });
}

async function enqueue(
  workflow: AutomationWorkflow,
  trigger: string,
  refs: StoreRefs,
) {
  const taskResponse = await refs.call("read_super_agent_tasks");
  if (!taskResponse?.ok) {
    throw localizeHostError(
      new Error(taskResponse?.error || t("Task service is unavailable")),
    );
  }
  const taskId = `automation-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const task = {
    id: taskId,
    title: workflow.title,
    description: workflow.prompt,
    targetProject: workflow.targetProject || refs.getTarget()?.cwd || null,
    status: "pending",
    source: {
      channel: "automation",
      conversationId: workflow.id,
      userId: null,
      messageId: null,
    },
    automation: {
      workflowId: workflow.id,
      trigger,
      // Non-approval workflows are approved when created; the Agent Inbox
      // runtime auto-dispatches these without a manual click.
      autoDispatch: !workflow.requireApproval,
    },
    budget: workflow.maxCost || null,
    maxRetries: workflow.maxRetries ?? 2,
    retryCount: 0,
    events: [
      {
        at: now,
        type: "queued",
        status: "pending",
        message: `Queued by automation (${trigger}).`,
      },
    ],
  };
  const tasks = [...(taskResponse.data?.tasks ?? []), task];
  const write = await refs.call("write_super_agent_tasks", { tasks });
  if (!write?.ok) {
    throw localizeHostError(
      new Error(write?.error || t("Could not queue automation task")),
    );
  }
  await recordRun(
    workflow,
    {
      status: "queued",
      startedAt: now,
      taskId,
      message: t("Queued in Task center"),
    },
    { approvalPending: false, nextRunAt: nextAutomationRun(workflow, new Date(now)) },
    refs,
  );
  refs.notify({ title: t("Automation queued"), message: workflow.title, type: "success" });
}

async function reconcileRuns(current: AutomationWorkflow[], refs: StoreRefs) {
  const tracked = current.filter((workflow) =>
    ["queued", "retry_queued"].includes(workflow.history?.[0]?.status ?? ""),
  );
  if (!tracked.length) return;
  const response = await refs.call("read_super_agent_tasks");
  if (!response?.ok) return;
  const tasks = [...(response.data?.tasks ?? [])];
  let tasksChanged = false;
  const updates: { workflow: AutomationWorkflow; run: { status: string; startedAt: string; taskId: string; message: string } }[] = [];
  for (const workflow of tracked) {
    const lastRun = workflow.history?.[0];
    const index = tasks.findIndex((task) => (task as { id?: string }).id === lastRun?.taskId);
    if (index < 0) continue;
    const task = tasks[index] as {
      status?: string;
      retryCount?: number;
      failReason?: string | null;
      result?: { summary?: string; failReason?: string | null };
      events?: unknown[];
    };
    if (task.status === "done") {
      updates.push({
        workflow,
        run: {
          status: "completed",
          startedAt: new Date().toISOString(),
          taskId: (task as { id: string }).id,
          message: task.result?.summary || t("Task completed"),
        },
      });
    } else if (
      task.status === "failed" &&
      Number(task.retryCount || 0) < Number(workflow.maxRetries || 0)
    ) {
      const now = new Date().toISOString();
      tasks[index] = {
        ...task,
        status: "pending",
        retryCount: Number(task.retryCount || 0) + 1,
        failReason: null,
        result: { status: null, summary: null, completedAt: null, failReason: null },
        events: [
          ...(task.events || []),
          {
            at: now,
            type: "automation_retry",
            status: "pending",
            message: t("Automatically queued for retry"),
          },
        ],
      };
      tasksChanged = true;
      updates.push({
        workflow,
        run: {
          status: "retry_queued",
          startedAt: now,
          taskId: (task as { id: string }).id,
          message: t("Automatically queued for retry"),
        },
      });
    } else if (task.status === "failed") {
      updates.push({
        workflow,
        run: {
          status: "failed",
          startedAt: new Date().toISOString(),
          taskId: (task as { id: string }).id,
          message: task.result?.failReason || task.failReason || t("Retry limit reached"),
        },
      });
    }
  }
  if (tasksChanged) await refs.call("write_super_agent_tasks", { tasks });
  for (const update of updates) {
    try {
      await recordRun(
        update.workflow,
        update.run,
        { approvalPending: false, nextRunAt: update.workflow.nextRunAt },
        refs,
      );
    } catch {
      // Keep reconciling the remaining runs; a single record failure must not
      // prevent due workflows from being scheduled afterward.
    }
  }
}
