import { create } from "zustand";
// @ts-expect-error native shared module without declarations
import { taskWriteParams } from "../../../../public/super-agent/task-persistence.js";
import { isRuntimeProcessClosedError, localizeHostError } from "../../shared/hostErrors.js";
import { t } from "../../shared/i18n.js";
import type { WorkCreationRequest } from "../../shared/workCreation";
import { type AutomationDraft, automationDraftScope, createAutomationDraftStore } from "./draft-store";
import {
  type AutomationFilter,
  type AutomationWorkflow,
  nextAutomationRun,
} from "./logic";

export interface AutomationAppOptions {
  call: (
    operation: string,
    params?: unknown,
    options?: { target?: unknown },
  ) => Promise<{
    ok?: boolean;
    error?: string;
    data?: {
      drafts?: AutomationDraft[];
      draft?: AutomationDraft;
      workflows?: AutomationWorkflow[];
      workflow?: AutomationWorkflow;
      revision?: string;
      tasks?: unknown[];
      projects?: Array<{ cwd?: string; path?: string }>;
      workspace?: { workflows?: AutomationWorkflow[]; revision?: string };
    };
  }>;
  getTarget?: () => { sceneId?: string; workspaceId?: string; instanceId?: string; sessionId?: string; cwd?: string } | null;
  listWorkspaceStatus?: () => Promise<AutomationWorkspaceStatus[]>;
  backgroundWorkerStatus?: () => Promise<unknown>;
  startBackgroundWorker?: () => Promise<unknown>;
  stopBackgroundWorker?: () => Promise<unknown>;
  backgroundWorkerLoginEnabled?: () => Promise<unknown>;
  setBackgroundWorkerLoginEnabled?: (enabled: boolean) => Promise<unknown>;
  openWorkspaceTasks?: (path: string) => Promise<void>;
  approvePendingTask?: (taskId: string, target: ReturnType<NonNullable<AutomationAppOptions["getTarget"]>>) => Promise<boolean | undefined>;
  openApp?: (pluginId: string) => void;
  notify?: (payload: { title: string; message?: string; type?: string }) => void;
  notifySystem?: (title: string, message: string) => void;
  confirmRemove?: (message: string) => boolean | Promise<boolean>;
  pollIntervalMs?: number;
  retryDelayMs?: number;
}

interface AutomationState {
  draftStore: ReturnType<typeof createAutomationDraftStore>;
  workflows: AutomationWorkflow[];
  pendingApprovalTasks: Record<string, string>;
  approvalTasksError: boolean;
  revision: string | null;
  filter: AutomationFilter;
  focusWorkflowId: string | null;
  creationRequest: WorkCreationRequest | null;
  requestCreation(projectPath: string): void;
  clearCreation(): void;
  syncTarget(): void;
  focusWorkflow(id: string | null): void;
  loading: boolean;
  error: Error | null;
  notify(payload: { title: string; message?: string; type?: string }): void;
  getTarget(): ReturnType<NonNullable<AutomationAppOptions["getTarget"]>>;
  setFilter(filter: AutomationFilter): void;
  listProjects(): Promise<string[]>;
  load(): Promise<AutomationWorkflow[]>;
  saveWorkflow(workflow: AutomationWorkflow): Promise<AutomationWorkflow | undefined>;
  duplicateWorkflow(workflow: AutomationWorkflow): Promise<AutomationWorkflow | undefined>;
  removeWorkflow(id: string): Promise<void>;
  runWorkflow(workflow: AutomationWorkflow, trigger?: string): Promise<void>;
  approveQueuedTask(workflowId: string): Promise<void>;
  tick(): Promise<void>;
  startScheduler(): void;
  destroy(): void;
}

export function createAutomationStore(options: AutomationAppOptions) {
  const draftStore = createAutomationDraftStore(options);
  const call = options.call;
  const getTarget = options.getTarget ?? (() => null);
  const notify = options.notify ?? (() => {});
  const confirmRemove =
    options.confirmRemove ??
    ((message: string) => globalThis.confirm?.(message) ?? false);
  const pollIntervalMs = options.pollIntervalMs ?? 60_000;
  const retryDelayMs = options.retryDelayMs ?? 1000;
  let activeScope = automationDraftScope(getTarget());
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let tickRequested = false;
  let loadSeq = 0;
  let pendingApprovalOrigin: string | null = null;
  let creationSequence = 0;
  let runtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let runtimeRetryAttempts = 0;
  const runtimeRetryDelays = [1200, 2000, 3000, 5000, 8000, 12000];

  return create<AutomationState>()((set, get) => {
    function callForTarget(target: ReturnType<typeof getTarget>): AutomationAppOptions["call"] {
      return (operation, params) => {
        if (options.getTarget && !target)
          return Promise.reject(new Error("No active session for automation request"));
        return call(operation, params, target ? { target } : undefined);
      };
    }
    function scopedRefs(): StoreRefs {
      const target = getTarget();
      const scope = automationDraftScope(target);
      const epoch = draftStore.getState().epoch;
      return {
        call: callForTarget(target),
        getTarget,
        notify,
        set,
        get,
        invalidateLoads: () => { loadSeq += 1; },
        isCurrent: () =>
          scope === automationDraftScope(getTarget()) && epoch === draftStore.getState().epoch,
      };
    }
    function scheduleReadinessRetry(raw: string) {
      if (runtimeRetryTimer) return;
      // A fresh scene/runtime can reject the first workflow read before it
      // finishes booting. Retry with backoff so the first open of the
      // Automation app heals itself instead of showing a stale error banner
      // until the next scheduler tick.
      if (
        !/unknown_instance|UnknownInstance|runtime unavailable|not ready|403/i.test(raw)
      ) {
        return;
      }
      const delay =
        runtimeRetryDelays[Math.min(runtimeRetryAttempts, runtimeRetryDelays.length - 1)] ??
        1200;
      runtimeRetryAttempts += 1;
      runtimeRetryTimer = setTimeout(() => {
        runtimeRetryTimer = null;
        void get().load();
      }, delay);
    }

    return {
    draftStore,
    workflows: [],
    pendingApprovalTasks: {},
    approvalTasksError: false,
    revision: null,
    filter: "all",
    focusWorkflowId: null,
    creationRequest: null,
    requestCreation(projectPath) {
      set({ creationRequest: { sequence: ++creationSequence, projectPath }, focusWorkflowId: null, filter: "all" });
    },
    clearCreation() { set({ creationRequest: null }); },
    syncTarget() {
      const nextScope = automationDraftScope(getTarget());
      draftStore.getState().syncScope();
      if (nextScope === activeScope) return;
      activeScope = nextScope;
      loadSeq += 1;
      if (runtimeRetryTimer) clearTimeout(runtimeRetryTimer);
      runtimeRetryTimer = null;
      runtimeRetryAttempts = 0;
      pendingApprovalOrigin = null;
      set({
        workflows: [],
        pendingApprovalTasks: {},
        approvalTasksError: false,
        revision: null,
        focusWorkflowId: null,
        creationRequest: null,
        loading: false,
        error: null,
      });
      if (!pollTimer) {
        void get().load();
      } else if (ticking) {
        tickRequested = true;
        void get().load();
      } else {
        void get().tick();
      }
    },
    focusWorkflow(id) {
      set({ focusWorkflowId: id, filter: "all" });
    },
    loading: false,
    error: null,

    notify(payload) {
      notify(payload);
    },

    getTarget() {
      return getTarget();
    },

    setFilter(filter) {
      set({ filter, focusWorkflowId: null });
    },

    async listProjects() {
      if (typeof call !== "function") return [];
      const target = getTarget();
      const origin = automationDraftScope(target);
      const fixedCall = callForTarget(target);
      const paths = new Set<string>();
      try {
        const response = await fixedCall("list_super_agent_projects");
        if (origin !== automationDraftScope(getTarget())) return [];
        for (const project of response?.data?.projects ?? []) {
          const path = String(project?.cwd || project?.path || "").trim();
          if (path) paths.add(path);
        }
      } catch {
        // Fall through to workflow-derived suggestions.
      }
      try {
        const response = await fixedCall("automation_workspace", { action: "list" });
        if (origin !== automationDraftScope(getTarget())) return [];
        for (const workflow of response?.data?.workflows ?? []) {
          const path = String(workflow?.targetProject || "").trim();
          if (path) paths.add(path);
        }
      } catch {
        // Suggestions are best-effort.
      }
      return origin === automationDraftScope(getTarget()) ? [...paths] : [];
    },

    async load() {
      if (typeof call !== "function") return get().workflows;
      const seq = ++loadSeq;
      const target = getTarget();
      const origin = automationDraftScope(target);
      const fixedCall = callForTarget(target);
      set({ loading: true });
      try {
        const snapshot = await listWorkflowsWithRetry(
          fixedCall,
          retryDelayMs,
          () => seq === loadSeq && origin === automationDraftScope(getTarget()),
        );
        if (seq !== loadSeq || origin !== automationDraftScope(getTarget())) return get().workflows;
        const pendingApprovalTasks: Record<string, string> = {};
        let approvalTasksError = false;
        try {
          const response = await fixedCall("read_super_agent_tasks");
          if (!response?.ok || !Array.isArray(response.data?.tasks)) {
            throw new Error(response?.error || t("Task service is unavailable"));
          }
          for (const raw of response.data.tasks) {
            const task = raw as {
              id?: unknown;
              status?: unknown;
              automation?: { workflowId?: unknown; autoDispatch?: unknown };
            };
            const workflowId = task?.automation?.workflowId;
            if (
              task?.status === "pending" &&
              task.automation?.autoDispatch !== true &&
              typeof workflowId === "string" &&
              typeof task.id === "string" &&
              !pendingApprovalTasks[workflowId]
            ) {
              pendingApprovalTasks[workflowId] = task.id;
            }
          }
        } catch {
          approvalTasksError = true;
        }
        if (seq !== loadSeq || origin !== automationDraftScope(getTarget())) return get().workflows;
        runtimeRetryAttempts = 0;
        if (runtimeRetryTimer) clearTimeout(runtimeRetryTimer);
        runtimeRetryTimer = null;
        pendingApprovalOrigin = origin;
        set({ workflows: snapshot.workflows, revision: snapshot.revision, pendingApprovalTasks, approvalTasksError, error: null });
        return snapshot.workflows;
      } catch (reason) {
        if (seq !== loadSeq || origin !== automationDraftScope(getTarget())) return get().workflows;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        set({ error: automationStorageError(error.message), revision: null });
        scheduleReadinessRetry(error.message);
        return get().workflows;
      } finally {
        if (seq === loadSeq) {
          if (origin === automationDraftScope(getTarget())) set({ loading: false });
          else get().syncTarget();
        }
      }
    },

    async saveWorkflow(workflow) {
      const target = getTarget();
      const origin = automationDraftScope(target);
      const epoch = draftStore.getState().epoch;
      const fixedCall = callForTarget(target);
      let revision = get().revision;
      const creating = !get().workflows.some((item) => item.id === workflow.id);
      if (!revision || creating) {
        try {
          const snapshot = await listWorkflowsWithRetry(fixedCall, retryDelayMs);
          revision = snapshot.revision;
          if (creating) {
            const saved = snapshot.workflows.find((item) => item.id === workflow.id);
            if (saved) {
              if (!sameWorkflowIntent(saved, workflow))
                throw new Error(t("An automation with this ID already exists. Refresh before editing."));
              if (origin === automationDraftScope(getTarget()) && epoch === draftStore.getState().epoch) {
                loadSeq += 1;
                set({ workflows: snapshot.workflows, revision: snapshot.revision });
              }
              return saved;
            }
          }
        } catch (reason) {
          throw automationStorageError(reason instanceof Error ? reason.message : String(reason));
        }
      }
      if (origin !== automationDraftScope(getTarget()) || epoch !== draftStore.getState().epoch)
        return undefined;
      const response = await fixedCall("automation_workspace", { action: "upsert", workflow, expectedRevision: revision });
      if (!response?.ok) {
        throw automationStorageError(response?.error || t("Could not save automation"));
      }
      const workflows =
        response.data?.workspace?.workflows ?? response.data?.workflows ?? get().workflows;
      if (!response.data?.workspace?.revision)
        throw new Error(t("Automation save result is unconfirmed. Refresh before editing again."));
      if (origin === automationDraftScope(getTarget()) && epoch === draftStore.getState().epoch) {
        loadSeq += 1;
        set({ workflows, revision: response.data.workspace.revision });
      }
      return response.data?.workflow;
    },

    async duplicateWorkflow(workflow) {
      const base: AutomationWorkflow = {
        ...workflow,
        id: `automation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: `${workflow.title || t("Untitled automation")} ${t("(copy)")}`.trim(),
        approvalPending: false,
        history: [],
      };
      const copy: AutomationWorkflow = {
        ...base,
        nextRunAt:
          base.schedule !== "manual"
            ? nextAutomationRun(base)
            : null,
      };
      return get().saveWorkflow(copy);
    },

    async removeWorkflow(id) {
      const refs = scopedRefs();
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
      if (!refs.isCurrent()) return;
      const revision = get().revision;
      if (!revision) {
        notify({ title: t("Refresh automation rules before editing them."), type: "error" });
        return;
      }
      const response = await refs.call("automation_workspace", { action: "remove", id, expectedRevision: revision });
      if (!refs.isCurrent()) return;
      if (!response?.ok) {
        notify({
          title: t("Could not remove automation"),
          message: response?.error
            ? automationStorageError(response.error).message
            : undefined,
          type: "error",
        });
        return;
      }
      const workflows = response.data?.workflows ?? get().workflows;
      if (!response.data?.revision) {
        notify({ title: t("Automation save result is unconfirmed. Refresh before editing again."), type: "error" });
        set({ revision: null });
        return;
      }
      loadSeq += 1;
      set({ workflows, revision: response.data.revision });
    },

    async runWorkflow(workflow, trigger = "manual") {
      if (trigger === "approval") return get().approveQueuedTask(workflow.id);
      const refs = scopedRefs();
      try {
        await enqueue(workflow, trigger, refs);
        if (refs.isCurrent()) await get().load();
      } catch (reason) {
        if (!refs.isCurrent()) return;
        notify({
          title: t("Could not run automation"),
          message: localizeHostError(reason).message,
          type: "error",
        });
      }
    },

    async approveQueuedTask(workflowId) {
      const taskId = get().pendingApprovalTasks[workflowId];
      if (!taskId) return;
      const sourceTarget = getTarget();
      const origin = automationDraftScope(sourceTarget);
      const epoch = draftStore.getState().epoch;
      if (pendingApprovalOrigin && pendingApprovalOrigin !== origin) return;
      const isCurrent = () =>
        origin === automationDraftScope(getTarget()) && epoch === draftStore.getState().epoch;
      if (!options.approvePendingTask) {
        if (!isCurrent()) return;
        options.openApp?.("com.zicode.tasks");
        window.dispatchEvent(new CustomEvent("zicode:open-task", { detail: { taskId } }));
        return;
      }
      try {
        await options.approvePendingTask(taskId, sourceTarget);
        if (isCurrent()) await get().load();
      } catch (reason) {
        if (!isCurrent()) return;
        notify({ title: t("Could not approve task"), message: localizeHostError(reason).message, type: "error" });
        await get().load();
      }
    },

    async tick() {
      if (ticking || typeof call !== "function") return;
      ticking = true;
      try {
        // The OS-lock owner in Host schedules and reconciles every workspace.
        // Page polling only observes it; manual runs still use enqueue().
        await get().load();
      } finally {
        ticking = false;
        if (tickRequested && pollTimer) {
          tickRequested = false;
          void get().tick();
        }
      }
    },

    startScheduler() {
      if (pollTimer) return;
      pollTimer = setInterval(() => void get().tick(), pollIntervalMs);
      if (ticking) tickRequested = true;
      else void get().tick();
    },

      destroy() {
        loadSeq += 1;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        tickRequested = false;
        if (runtimeRetryTimer) clearTimeout(runtimeRetryTimer);
        runtimeRetryTimer = null;
        runtimeRetryAttempts = 0;
        set({ loading: false });
      },
    };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AutomationWorkspaceStatus {
  workspaceId: string;
  path: string;
  scannedAt: string;
  status: "ready" | "uninitialized" | "error";
  workflowCount: number;
  dueCount: number;
  errorCode?: string | null;
  taskStatus: "ready" | "uninitialized" | "error";
  pendingCount: number;
  approvalCount: number;
  runningCount: number;
  blockedCount: number;
  failedCount: number;
  taskErrorCode?: string | null;
}

function sameWorkflowIntent(saved: AutomationWorkflow, requested: AutomationWorkflow): boolean {
  return (
    saved.id === requested.id &&
    saved.title === requested.title.trim() &&
    saved.prompt === requested.prompt.trim() &&
    (saved.targetProject || "") === (requested.targetProject || "").trim() &&
    saved.enabled === requested.enabled &&
    saved.schedule === requested.schedule &&
    (saved.intervalMinutes ?? null) === (requested.intervalMinutes ?? null) &&
    (saved.dailyTime ?? null) === (requested.dailyTime ?? null) &&
    Boolean(saved.requireApproval) === Boolean(requested.requireApproval) &&
    (saved.maxCost ?? null) === (requested.maxCost ?? null) &&
    Number(saved.maxRetries ?? 0) === Number(requested.maxRetries ?? 0)
  );
}

function automationStorageError(raw: string): Error {
  const messages: Record<string, string> = {
    automation_workspace_revision_required: "Refresh automation rules before editing them.",
    automation_workspace_conflict: "Automation rules changed in another window. Refresh before editing again.",
    automation_workspace_busy: "Automation storage is busy. Try again shortly.",
    automation_workspace_invalid: "Automation storage is damaged. Keep the file and its backups; no changes were saved.",
    automation_workspace_too_large: "Automation storage exceeds its size limit. Keep the file and its backups.",
    automation_workspace_limit: "Automation storage has reached its workflow limit.",
  };
  return messages[raw] ? new Error(t(messages[raw])) : localizeHostError(new Error(raw));
}

async function listWorkflowsWithRetry(
  call: AutomationAppOptions["call"],
  retryDelayMs: number,
  isCurrent: () => boolean = () => true,
): Promise<{ workflows: AutomationWorkflow[]; revision: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!isCurrent()) throw new Error("Automation read was superseded");
    try {
      const response = await call("automation_workspace", { action: "list" });
      if (!response?.ok) {
        throw new Error(response?.error || t("Automation service is unavailable"));
      }
      if (!Array.isArray(response.data?.workflows) || !response.data?.revision)
        throw new Error(t("Automation storage needs a newer desktop runtime."));
      return { workflows: response.data.workflows, revision: response.data.revision };
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
  invalidateLoads: () => void;
  isCurrent: () => boolean;
}

async function recordRun(
  workflow: AutomationWorkflow,
  run: { status: string; startedAt: string; taskId: string | null; message?: string },
  { approvalPending = false, nextRunAt }: { approvalPending?: boolean; nextRunAt?: string | null },
  refs: StoreRefs,
) {
  const runId = `${workflow.id}:${run.taskId ?? "none"}:${run.status}:${run.startedAt}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await listWorkflowsWithRetry(refs.call, 0);
    if (snapshot.workflows.find((item) => item.id === workflow.id)?.history?.some((item) => (item as { id?: string }).id === runId)) {
      if (refs.isCurrent()) {
        refs.invalidateLoads();
        refs.set({ workflows: snapshot.workflows, revision: snapshot.revision });
      }
      return;
    }
    const response = await refs.call("automation_workspace", {
      action: "record_run",
      id: workflow.id,
      run: { ...run, id: runId },
      approvalPending,
      nextRunAt: nextRunAt ?? workflow.nextRunAt,
      expectedRevision: snapshot.revision,
    });
    if (response?.ok) {
      if (refs.isCurrent()) {
        refs.invalidateLoads();
        refs.set({
          workflows: response.data?.workspace?.workflows ?? refs.get().workflows,
          revision: response.data?.workspace?.revision ?? null,
        });
      }
      return;
    }
    if (attempt < 2 && ["automation_workspace_conflict", "automation_workspace_busy"].includes(response?.error ?? "")) {
      await sleep(40 * (attempt + 1));
      continue;
    }
    throw automationStorageError(response?.error || t("Could not update automation history"));
  }
}

async function enqueue(
  workflow: AutomationWorkflow,
  trigger: string,
  refs: StoreRefs,
) {
  if (!refs.isCurrent()) return;
  const taskResponse = await refs.call("read_super_agent_tasks");
  if (!refs.isCurrent()) return;
  if (!taskResponse?.ok) {
    throw localizeHostError(
      new Error(taskResponse?.error || t("Task service is unavailable")),
    );
  }
  const taskId = trigger === "schedule"
    ? `automation-task-${workflow.id}-${workflow.nextRunAt ?? "first"}`
    : `automation-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const existing = (taskResponse.data?.tasks ?? []).find(
    (item) => (item as { id?: string })?.id === taskId,
  ) as { events?: Array<{ at?: string }> } | undefined;
  if (existing) {
    const eventAt = existing.events?.[0]?.at;
    const startedAt = eventAt && Number.isFinite(Date.parse(eventAt)) ? eventAt : now;
    await recordRun(
      workflow,
      { status: "queued", startedAt, taskId, message: t("Queued in Task center") },
      { approvalPending: false, nextRunAt: nextAutomationRun(workflow, new Date(startedAt)) },
      refs,
    );
    return;
  }
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
        message: t(`Queued by automation (${trigger}).`),
      },
    ],
  };
  const tasks = [...(taskResponse.data?.tasks ?? []), task];
  if (!refs.isCurrent()) return;
  const write = await refs.call("write_super_agent_tasks", taskWriteParams(tasks, taskResponse.data?.revision));
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
  if (refs.isCurrent())
    refs.notify({ title: t("Automation queued"), message: workflow.title, type: "success" });
}
