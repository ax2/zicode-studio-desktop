import { create } from "zustand";
import { localizeHostError } from "../../shared/hostErrors.js";
import { t } from "../../shared/i18n.js";
import type { CondaDiscovery } from "./CondaRegistryPicker";
import type { PrepareProjectChatDraft } from "./chat-draft";
import { type CommitDiff, parseCommitDiff } from "./commit-diff";
import { createContextDraftMemory } from "./context-draft-memory";
import { createContextRecovery } from "./context-recovery";
import type { ImportedContextRecovery } from "./context-recovery-import";
import type { ContextRecoverySnapshot } from "./context-recovery-repository";
import { createDirectoryContext, directoryScope } from "./directory-context";
import type { EnvironmentReport } from "./EnvironmentPanel";
import { type GitHistory, type GitHistoryCursor, parseGitHistory } from "./git-history";
import { createGitReviewAction, type PrepareGitReview } from "./git-review";
import type { GitDiff, GitDiffMode, GitFile, GitStatus } from "./git-status";
import { createContextPackAction, type PrepareContextPack } from "./knowledge-chat";
import {
  emptyProjectSnapshot,
  type KnowledgeSnapshot,
  type ProjectProfile,
  type ProjectSnapshot,
  type ProjectTarget,
  projectWorkspaceKey,
  readProjectWorkspaceProfile,
  saveLocalProjectProfile,
  searchable,
} from "./logic";
import type { ProjectStorageReport } from "./ProjectStoragePanel";
import type { ToolPathSettings, ToolPathsApi } from "./ProjectToolPaths";
import {
  canonicalProjectProfile,
  mergeProjectProfile,
  type ProfileField,
} from "./project-profile-merge";
import type {
  ProjectRun,
  ProjectRunHistory,
  ProjectRunnerApi,
  TaskCatalog,
  TaskDirectories,
} from "./project-runner";
import type { TerminalApi, TerminalFrame, TerminalOperation } from "./project-terminal";
import { projectWorkFromResponses } from "./project-work";
import { createRunAnalysisAction, type PrepareRunAnalysis } from "./run-analysis";
import { parseWorkspaceDiff } from "./workspace-diff";

export interface NotesGatewayLike {
  list?: (sceneId: string, workspaceId: string) => Promise<unknown>;
  knowledge?: (sceneId: string, workspaceId: string) => Promise<unknown>;
}

export interface ArtifactGatewayLike {
  list?: (sceneId: string, workspaceId: string) => Promise<unknown>;
}

export interface DataGatewayLike {
  projectTaskDirectories?: (workspace: string) => Promise<{ discovery: TaskDirectories }>;
  projectTaskValidateDirectory?: (
    workspace: string,
    directory: string,
  ) => Promise<{ directory: string }>;
  projectTaskCatalog?: (workspace: string, directory?: string) => Promise<{ catalog: TaskCatalog }>;
  projectTaskRuns?: (
    workspace: string,
  ) => Promise<{ runs: ProjectRun[]; historyStatus?: ProjectRunHistory["historyStatus"] }>;
  workspaceEnvironment?: (
    workspaceId: string,
    directory?: string,
  ) => Promise<{ report: EnvironmentReport }>;
  workspaceGitDiff?: (workspaceId: string, mode: GitDiffMode) => Promise<{ diff: GitDiff }>;
  workspaceGitStatus?: (workspaceId: string) => Promise<{ status: GitStatus }>;
  workspaceGitHistory?: (workspaceId: string, cursor?: GitHistoryCursor) => Promise<{ history: GitHistory }>;
  workspaceCommitDiff?: (workspaceId: string, oid: string) => Promise<{ diff: CommitDiff }>;
  listSessions?: (workspaceId: string) => Promise<unknown>;
  listFiles?: (workspaceId: string, root: string) => Promise<unknown>;
  searchSessions?: (workspaceId: string, query: string) => Promise<unknown>;
}

export interface ProjectWorkspaceOptions {
  readStorage?: (workspaceId: string, directory: string, deep?: boolean) => Promise<ProjectStorageReport>;
  openStorageEntry?: (workspaceId: string, relativePath: string) => Promise<void>;
  canRunProjectTasks?: boolean;
  controlGateway?: {
    workspaceGitStage?(workspaceId: string, file: GitFile): Promise<{ status: GitStatus }>;
    workspaceGitUnstage?(workspaceId: string, file: GitFile): Promise<{ status: GitStatus }>;
    projectEnvironment?(
      workspace: string,
      settings?: ToolPathSettings,
    ): Promise<{ settings: ToolPathSettings }>;
    projectCondaEnvironments?(workspace: string): Promise<{ discovery: CondaDiscovery }>;
    startProjectTask(
      workspace: string,
      name: string,
      fingerprint: string,
      directory?: string,
    ): Promise<unknown>;
    stopProjectTask(workspace: string, runId: string): Promise<unknown>;
    projectTerminal?(
      operation: TerminalOperation,
      workspace: string,
      parameters?: Record<string, unknown>,
    ): Promise<TerminalFrame>;
    clearProjectTaskHistory?(workspace: string): Promise<unknown>;
  };
  notesGateway?: NotesGatewayLike;
  artifactGateway?: ArtifactGatewayLike;
  dataGateway?: DataGatewayLike;
  call?: (
    operation: string,
    params?: unknown,
  ) => Promise<{ ok?: boolean; error?: string; data?: unknown }>;
  getTarget?: () => ProjectTarget | null;
  storage?: Storage | null;
  openApp?: (pluginId: string) => void;
  onPrepareContextPack?: PrepareProjectChatDraft;
  onPrepareRunAnalysis?: PrepareProjectChatDraft;
  onPrepareGitReview?: PrepareGitReview;
  /** Open the shared workspace switcher (list / switch / create projects). */
  onManageProjects?: () => void;
  notify?: (payload: { title: string; message?: string; type?: string }) => void;
}

export type ProjectView =
  | "overview"
  | "context"
  | "knowledge"
  | "search"
  | "activity"
  | "environment"
  | "storage"
  | "runner"
  | "terminal"
  | "work";

interface ProjectWorkspaceState {
  readStorage?: (workspaceId: string, directory: string, deep?: boolean) => Promise<ProjectStorageReport>;
  openStorageEntry?: (workspaceId: string, relativePath: string) => Promise<void>;
  canStageGit: boolean;
  canUnstageGit: boolean;
  stageGitFile(workspaceId: string, file: GitFile): Promise<GitStatus>;
  unstageGitFile(workspaceId: string, file: GitFile): Promise<GitStatus>;
  projectDirectory: string;
  setProjectDirectory(directory: string, expectedScope: string): void;
  toolPaths: ToolPathsApi;
  terminal: TerminalApi;
  runner: ProjectRunnerApi;
  readEnvironment(workspaceId: string, directory?: string): Promise<EnvironmentReport>;
  refreshRevision: number;
  readGitStatus(workspaceId: string): Promise<GitStatus>;
  readGitHistory(workspaceId: string, cursor?: GitHistoryCursor): Promise<GitHistory>;
  readCommitDiff(workspaceId: string, oid: string): Promise<CommitDiff>;
  readGitDiff(workspaceId: string, mode: GitDiffMode): Promise<GitDiff>;
  prepareGitReview: PrepareGitReview;
  target: ProjectTarget | null;
  activeView: ProjectView;
  snapshot: ProjectSnapshot;
  loading: boolean;
  error: Error | null;
  profile: ProjectProfile;
  profileRevision: string | null;
  profileError: string | null;
  contextDraft: ProjectProfile | null;
  contextConflicts: ProfileField[];
  contextRecoverySnapshots: ContextRecoverySnapshot[];
  contextRecoveryUnreadable: number;
  contextRecoveryRemovableUnreadable: number;
  contextRecoveryPending: boolean;
  contextRecoveryError: string | null;
  refreshContextRecovery(expectedScope?: string): Promise<void>;
  importContextRecovery(expectedScope: string, copy: ImportedContextRecovery): Promise<void>;
  restoreContextRecovery(snapshot: ContextRecoverySnapshot): void;
  discardContextRecovery(snapshot: ContextRecoverySnapshot): Promise<void>;
  discardUnreadableContextRecovery(expectedScope: string): Promise<void>;
  discardContextDraft(): void;
  isCurrentContextRecovery(id: string): boolean;
  searchQuery: string;
  sessionSearchResults: unknown[];
  openApp(pluginId: string): void;
  prepareContextPack: PrepareContextPack;
  prepareRunAnalysis: PrepareRunAnalysis;
  onManageProjects(): void;
  notify(payload: { title: string; message?: string; type?: string }): void;
  setTarget(target: ProjectTarget | null): void;
  setActiveView(view: ProjectView): void;
  load(): Promise<void>;
  loadProfile(): Promise<ProjectProfile>;
  saveProfile(nextProfile: ProjectProfile): Promise<ProjectProfile>;
  setContextDraft(patch: Partial<ProjectProfile>): void;
  resolveContextConflict(field: ProfileField, choice: "saved" | "draft"): void;
  runProjectSearch(query: string): Promise<void>;
  openResult(result: Record<string, unknown>): void;
}

export function createProjectWorkspaceStore(options: ProjectWorkspaceOptions) {
  const notesGateway = options.notesGateway;
  const artifactGateway = options.artifactGateway;
  const dataGateway = options.dataGateway;
  const call = options.call;
  const getTarget = options.getTarget ?? (() => null);
  const storage = options.storage;
  const notify = options.notify ?? (() => {});
  const openApp = options.openApp ?? (() => {});
  const onManageProjects = options.onManageProjects ?? (() => {});

  const directories = createDirectoryContext();
  const contextDrafts = createContextDraftMemory();
  let loadGeneration = 0;
  let profileReadGeneration = 0;
  let searchGeneration = 0;
  let targetGeneration = 0;
  let contextDraftGeneration = 0;

  let updateRecovery = (_view: {
    snapshots: ContextRecoverySnapshot[];
    unreadable: number;
    removableUnreadable: number;
    pending: boolean;
    error: string | null;
  }) => {};
  const contextRecovery = createContextRecovery({
    onChange(view) {
      updateRecovery(view);
    },
  });
  const store = create<ProjectWorkspaceState>()((set, get) => ({
    readStorage: options.readStorage,
    openStorageEntry: options.openStorageEntry,
    canStageGit:
      options.canRunProjectTasks === true && Boolean(options.controlGateway?.workspaceGitStage),
    canUnstageGit:
      options.canRunProjectTasks === true && Boolean(options.controlGateway?.workspaceGitUnstage),
    async stageGitFile(workspaceId, file) {
      if (!options.canRunProjectTasks || !options.controlGateway?.workspaceGitStage)
        throw new Error("git_stage_unsupported");
      const response = await options.controlGateway.workspaceGitStage(workspaceId, file);
      if (!response?.status) throw new Error("git_stage_result_unknown");
      return response.status;
    },
    async unstageGitFile(workspaceId, file) {
      if (!options.canRunProjectTasks || !options.controlGateway?.workspaceGitUnstage)
        throw new Error("git_unstage_unsupported");
      const response = await options.controlGateway.workspaceGitUnstage(workspaceId, file);
      if (!response?.status) throw new Error("git_unstage_result_unknown");
      return response.status;
    },
    projectDirectory: directories.read(getTarget()),
    setProjectDirectory(directory, expectedScope) {
      const target = get().target;
      if (directoryScope(target) !== expectedScope || !directories.select(target, directory))
        return;
      set({ projectDirectory: directory });
    },
    terminal: {
      canUse:
        options.canRunProjectTasks === true && Boolean(options.controlGateway?.projectTerminal),
      async request(operation, workspace, parameters) {
        if (!options.controlGateway?.projectTerminal) throw new Error("terminal_unsupported");
        return options.controlGateway.projectTerminal(operation, workspace, parameters);
      },
    },
    runner: {
      canRun: options.canRunProjectTasks === true && Boolean(options.controlGateway),
      async directories(workspace) {
        const response = await dataGateway?.projectTaskDirectories?.(workspace);
        if (!response?.discovery) throw new Error("task_unsupported");
        return response.discovery;
      },
      async validateDirectory(workspace, directory) {
        if (!dataGateway?.projectTaskValidateDirectory)
          throw new Error("task_directory_unsupported");
        let response: { directory: string };
        try {
          response = await dataGateway.projectTaskValidateDirectory(workspace, directory);
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message === "Unsupported data operation" ||
              error.message ===
                "Unsupported read-only data operation: project_task_validate_directory")
          )
            throw new Error("task_directory_unsupported");
          throw error;
        }
        if (response?.directory !== directory) throw new Error("task_directory_unconfirmed");
        return response.directory;
      },
      async catalog(workspace, directory) {
        const response = await dataGateway?.projectTaskCatalog?.(workspace, directory);
        if (!response?.catalog) throw new Error("task_unsupported");
        return response.catalog;
      },
      async runs(workspace) {
        const response = await dataGateway?.projectTaskRuns?.(workspace);
        if (!Array.isArray(response?.runs)) throw new Error("task_unsupported");
        return { runs: response.runs, historyStatus: response.historyStatus ?? "memory" };
      },
      async start(workspace, name, fingerprint, directory) {
        if (!options.controlGateway) throw new Error("task_unsupported");
        return options.controlGateway.startProjectTask(workspace, name, fingerprint, directory);
      },
      clearHistory: options.controlGateway?.clearProjectTaskHistory?.bind(options.controlGateway),
      async stop(workspace, runId) {
        if (!options.controlGateway) throw new Error("task_unsupported");
        return options.controlGateway.stopProjectTask(workspace, runId);
      },
    },
    target: getTarget(),
    toolPaths: {
      canEdit: Boolean(options.canRunProjectTasks && options.controlGateway?.projectEnvironment),
      discoverConda:
        options.canRunProjectTasks && options.controlGateway?.projectCondaEnvironments
          ? async (workspace) =>
              (await options.controlGateway!.projectCondaEnvironments!(workspace)).discovery
          : undefined,
      pickDirectory: options.canRunProjectTasks
        ? async () => {
            const invoke = (
              globalThis as {
                __TAURI__?: {
                  core?: {
                    invoke?: (
                      command: string,
                      params?: Record<string, unknown>,
                    ) => Promise<unknown>;
                  };
                };
              }
            ).__TAURI__?.core?.invoke;
            if (!invoke) throw new Error("project_environment_picker_unavailable");
            const selected = await invoke("plugin:dialog|open", {
              options: { directory: true, multiple: false },
            });
            if (selected === null || selected === undefined) return null;
            if (
              typeof selected !== "string" ||
              !(
                selected.startsWith("/") ||
                /^[a-z]:[\\/]/i.test(selected) ||
                selected.startsWith("\\\\")
              )
            )
              throw new Error("project_environment_picker_invalid");
            return selected;
          }
        : undefined,
      async read(workspace) {
        if (!options.controlGateway?.projectEnvironment)
          throw new Error("project_environment_unavailable");
        return (await options.controlGateway.projectEnvironment(workspace)).settings;
      },
      async save(workspace, settings) {
        if (!options.canRunProjectTasks || !options.controlGateway?.projectEnvironment)
          throw new Error("project_environment_unavailable");
        const result = await options.controlGateway.projectEnvironment(workspace, settings);
        set((state) => ({ refreshRevision: state.refreshRevision + 1 }));
        return result.settings;
      },
    },
    async readEnvironment(workspaceId, directory = "") {
      if (!dataGateway?.workspaceEnvironment) throw new Error("environment_unsupported");
      const response = await (directory
        ? dataGateway.workspaceEnvironment(workspaceId, directory)
        : dataGateway.workspaceEnvironment(workspaceId));
      if (!response?.report) throw new Error("environment_read_failed");
      return response.report;
    },
    refreshRevision: 0,
    prepareRunAnalysis: createRunAnalysisAction({
      getTarget: () => get().target,
      handoff: options.onPrepareRunAnalysis,
      notify,
    }),
    prepareGitReview: createGitReviewAction({
      getTarget: () => get().target,
      handoff: options.onPrepareGitReview,
      notify,
    }),
    async readCommitDiff(workspaceId, oid) {
      if (!dataGateway?.workspaceCommitDiff) throw new Error("git_unsupported");
      const response = await dataGateway.workspaceCommitDiff(workspaceId, oid);
      return parseCommitDiff(response?.diff, oid);
    },
    async readGitHistory(workspaceId, cursor) {
      if (!dataGateway?.workspaceGitHistory) throw new Error("git_unsupported");
      const response = await (cursor ? dataGateway.workspaceGitHistory(workspaceId, cursor) : dataGateway.workspaceGitHistory(workspaceId));
      return parseGitHistory(response?.history, cursor);
    },
    async readGitDiff(workspaceId, mode) {
      if (!dataGateway?.workspaceGitDiff) throw new Error("git_unsupported");
      const response = await dataGateway.workspaceGitDiff(workspaceId, mode);
      return parseWorkspaceDiff(response?.diff, mode);
    },
    async readGitStatus(workspaceId) {
      if (!dataGateway?.workspaceGitStatus) throw new Error("git_unsupported");
      const response = await dataGateway.workspaceGitStatus(workspaceId);
      if (!response?.status) throw new Error("git_read_failed");
      return response.status;
    },
    activeView: "overview",
    snapshot: emptyProjectSnapshot(),
    loading: false,
    error: null,
    profile: readProjectWorkspaceProfile({ storage, target: getTarget() }),
    profileRevision: null,
    profileError: null,
    contextDraft: null,
    contextConflicts: [],
    contextRecoverySnapshots: [],
    contextRecoveryUnreadable: 0,
    contextRecoveryRemovableUnreadable: 0,
    contextRecoveryPending: false,
    contextRecoveryError: null,
    searchQuery: "",
    sessionSearchResults: [],

    openApp(pluginId) {
      openApp(pluginId);
    },

    prepareContextPack: createContextPackAction({
      getSource: () => ({
        target: get().target,
        snapshot: get().snapshot.knowledge,
        loading: get().loading,
      }),
      handoff: options.onPrepareContextPack,
      notify,
    }),

    onManageProjects() {
      onManageProjects();
    },

    notify(payload) {
      notify(payload);
    },

    setTarget(target) {
      const changed = directoryScope(get().target) !== directoryScope(target);
      set({ target, projectDirectory: directories.read(target) });
      if (changed) {
        targetGeneration += 1;
        contextDraftGeneration += 1;
        profileReadGeneration += 1;
        searchGeneration += 1;
        const remembered = contextDrafts.read(target);
        void contextRecovery.flush();
        void contextRecovery.activate(target?.workspaceId ? directoryScope(target) : "");
        set({
          snapshot: emptyProjectSnapshot(),
          profile: readProjectWorkspaceProfile({ storage, target }),
          profileRevision: null,
          profileError: null,
          contextDraft: remembered?.draft ?? null,
          contextConflicts: remembered?.conflicts ?? [],
          contextRecoverySnapshots: [],
          contextRecoveryUnreadable: 0,
          contextRecoveryRemovableUnreadable: 0,
          contextRecoveryError: null,
          searchQuery: "",
          sessionSearchResults: [],
        });
      }
      if (changed) void get().load();
    },

    setActiveView(view) {
      set({ activeView: view });
    },

    async load() {
      const generation = ++loadGeneration;
      set((state) => ({ loading: true, error: null, refreshRevision: state.refreshRevision + 1 }));
      const target = get().target;
      const activeSceneId = target?.sceneId || "programming";
      const activeWorkspaceId = target?.workspaceId || "";
      const previousWork = get().snapshot.work;
      try {
        const [notes, artifacts, knowledge, loadedProfile, sessions, files, tasks, automations] =
          await Promise.all([
            notesGateway
              ?.list?.(activeSceneId, activeWorkspaceId)
              .catch((reason) => ({ error: reason })),
            artifactGateway
              ?.list?.(activeSceneId, activeWorkspaceId)
              .catch((reason) => ({ error: reason })),
            notesGateway
              ?.knowledge?.(activeSceneId, activeWorkspaceId)
              .catch((reason) => ({ error: reason })),
            get()
              .loadProfile()
              .catch((reason) => ({ error: reason })),
            target?.workspaceId
              ? dataGateway
                  ?.listSessions?.(target.workspaceId)
                  .catch((reason) => ({ error: reason }))
              : { sessions: [] },
            target?.workspaceId
              ? dataGateway
                  ?.listFiles?.(target.workspaceId, "")
                  .catch((reason) => ({ error: reason }))
              : { files: [] },
            call?.("read_super_agent_tasks").catch((reason) => ({ error: reason })),
            call?.("automation_workspace", { action: "list" }).catch((reason) => ({
              error: reason,
            })),
          ]);
        const notesAny = notes as {
          snapshot?: { notebooks?: unknown[]; notes?: unknown[] };
          error?: unknown;
        };
        const artifactsAny = artifacts as {
          snapshot?: { artifacts?: unknown[] };
          artifacts?: unknown[];
          error?: unknown;
        };
        const knowledgeAny = knowledge as {
          snapshot?: Partial<KnowledgeSnapshot>;
          error?: unknown;
        };
        const profileAny = loadedProfile as { error?: unknown };
        const sessionsAny = sessions as {
          sessions?: unknown[];
          projects?: Array<{ sessions?: unknown[] }>;
          error?: unknown;
        };
        const filesAny = files as { files?: unknown[]; entries?: unknown[]; error?: unknown };
        const tasksAny = tasks as { data?: { tasks?: unknown[] }; error?: unknown };
        const automationsAny = automations as {
          data?: { workflows?: unknown[]; workspace?: { workflows?: unknown[] } };
          error?: unknown;
        };
        const work = projectWorkFromResponses(tasks, automations, target, previousWork);
        const snapshot: ProjectSnapshot = {
          work,
          notebooks: notesAny?.snapshot?.notebooks ?? [],
          notes: (notesAny?.snapshot?.notes ?? []) as ProjectSnapshot["notes"],
          artifacts: (artifactsAny?.snapshot?.artifacts ??
            artifactsAny?.artifacts ??
            []) as ProjectSnapshot["artifacts"],
          knowledge: {
            links: knowledgeAny?.snapshot?.links ?? [],
            similar: knowledgeAny?.snapshot?.similar ?? [],
            conflicts: knowledgeAny?.snapshot?.conflicts ?? [],
          },
          sessions: (sessionsAny?.sessions ??
            sessionsAny?.projects?.[0]?.sessions ??
            []) as ProjectSnapshot["sessions"],
          files: (filesAny?.files ?? filesAny?.entries ?? []) as ProjectSnapshot["files"],
          taskCount: work.tasks.length,
          automationCount: work.automations.length,
          warnings: [
            notesAny?.error,
            artifactsAny?.error,
            knowledgeAny?.error,
            profileAny?.error,
            sessionsAny?.error,
            filesAny?.error,
            tasksAny?.error ||
              (work.tasksUnavailable &&
                t(
                  "Project tasks could not be refreshed. Any displayed items are from the last successful read.",
                )),
            automationsAny?.error ||
              (work.automationsUnavailable &&
                t(
                  "Project automations could not be refreshed. Any displayed items are from the last successful read.",
                )),
          ]
            .filter(Boolean)
            .map((warning) => localizeHostError(warning).message),
        };
        if (generation === loadGeneration) set({ snapshot });
      } catch (reason) {
        if (generation !== loadGeneration) return;
        set({
          error: localizeHostError(reason instanceof Error ? reason : new Error(String(reason))),
        });
      } finally {
        if (generation === loadGeneration) set({ loading: false });
      }
    },

    async loadProfile() {
      const generation = loadGeneration;
      const readGeneration = ++profileReadGeneration;
      const target = get().target;
      if (typeof call !== "function") return get().profile;
      try {
        const response = await call("read_project_profile");
        if (!response?.ok) {
          throw new Error(response?.error || t("Could not load project context"));
        }
        const data = response.data as { profile?: ProjectProfile; revision?: string } | undefined;
        const profile = canonicalProjectProfile(data?.profile || get().profile);
        const profileRevision =
          typeof data?.revision === "string" && /^[a-f0-9]{64}$/.test(data.revision)
            ? data.revision
            : null;
        if (generation !== loadGeneration || readGeneration !== profileReadGeneration)
          return get().profile;
        const remembered = contextDrafts.read(target);
        if (remembered && profileRevision && remembered.revision !== profileRevision) {
          const merged = mergeProjectProfile(remembered.base, remembered.draft, profile);
          contextDraftGeneration += 1;
          contextDrafts.write(target, {
            draft: merged.profile,
            base: profile,
            revision: profileRevision,
            conflicts: merged.conflicts,
          });
          set({
            profile,
            profileRevision,
            profileError: null,
            contextDraft: merged.profile,
            contextConflicts: merged.conflicts,
          });
        } else {
          set({ profile, profileRevision, profileError: null });
        }
        return profile;
      } catch (reason) {
        if (generation !== loadGeneration || readGeneration !== profileReadGeneration)
          return get().profile;
        const error = localizeHostError(reason);
        set({ profileError: error.message });
        throw error;
      }
    },

    async saveProfile(nextProfile) {
      const profileError = get().profileError;
      if (profileError) throw new Error(profileError);
      if (get().contextConflicts.length) {
        throw new Error(
          t("Choose which value to keep for each conflicting project context field."),
        );
      }
      const target = get().target;
      const saveTargetGeneration = targetGeneration;
      const savedDraftGeneration = contextDraftGeneration;
      if (typeof call === "function") {
        const response = await call("write_project_profile", {
          profile: nextProfile,
          expectedRevision: get().profileRevision,
        });
        if (!response?.ok) {
          throw localizeHostError(
            new Error(response?.error || t("Could not save project context")),
          );
        }
        const data = response.data as { profile?: ProjectProfile; revision?: string } | undefined;
        const profile = canonicalProjectProfile(data?.profile || nextProfile);
        const profileRevision =
          typeof data?.revision === "string" && /^[a-f0-9]{64}$/.test(data.revision)
            ? data.revision
            : null;
        if (
          targetGeneration === saveTargetGeneration &&
          projectWorkspaceKey(get().target) === projectWorkspaceKey(target) &&
          get().target?.sceneId === target?.sceneId
        ) {
          profileReadGeneration += 1;
          const retainedDraft =
            contextDraftGeneration === savedDraftGeneration ? null : get().contextDraft;
          contextDrafts.write(
            target,
            retainedDraft
              ? { draft: retainedDraft, base: profile, revision: profileRevision, conflicts: [] }
              : null,
          );
          const recoveryScope = target?.workspaceId ? directoryScope(target) : "";
          if (retainedDraft) {
            contextRecovery.remember(recoveryScope, retainedDraft, profile, profileRevision);
          } else {
            void contextRecovery.forgetOwn(recoveryScope);
          }
          set({
            profile,
            profileRevision,
            profileError: null,
            contextDraft: retainedDraft,
            contextConflicts: [],
          });
        }
        return profile;
      }
      saveLocalProjectProfile({ storage, target: get().target, profile: nextProfile });
      contextDrafts.write(get().target, null);
      void contextRecovery.forgetOwn(get().target?.workspaceId ? directoryScope(get().target) : "");
      set({ profile: nextProfile, profileError: null, contextDraft: null, contextConflicts: [] });
      return nextProfile;
    },

    setContextDraft(patch) {
      contextDraftGeneration += 1;
      const draft = { ...(get().contextDraft ?? get().profile), ...patch };
      const remembered = contextDrafts.read(get().target);
      contextDrafts.write(get().target, {
        draft,
        base: remembered?.base ?? canonicalProjectProfile(get().profile),
        revision: remembered?.revision ?? get().profileRevision,
        conflicts: remembered?.conflicts ?? [],
      });
      if (get().target?.workspaceId) {
        contextRecovery.remember(
          directoryScope(get().target),
          draft,
          remembered?.base ?? canonicalProjectProfile(get().profile),
          remembered?.revision ?? get().profileRevision,
        );
      }
      set({ contextDraft: draft });
    },

    resolveContextConflict(field, choice) {
      const target = get().target;
      const remembered = contextDrafts.read(target);
      if (!remembered?.conflicts.includes(field)) return;
      const draft = { ...remembered.draft };
      if (choice === "saved") draft[field] = canonicalProjectProfile(get().profile)[field];
      const conflicts = remembered.conflicts.filter((item) => item !== field);
      contextDraftGeneration += 1;
      contextDrafts.write(target, { ...remembered, draft, conflicts });
      if (target?.workspaceId) {
        contextRecovery.remember(
          directoryScope(target),
          draft,
          remembered.base,
          remembered.revision,
        );
      }
      set({ contextDraft: draft, contextConflicts: conflicts });
    },

    refreshContextRecovery(expectedScope) {
      const target = get().target;
      const scope = target?.workspaceId ? directoryScope(target) : "";
      if (expectedScope !== undefined && expectedScope !== scope) return Promise.resolve();
      return contextRecovery.flush().then(() => contextRecovery.activate(scope));
    },
    importContextRecovery(expectedScope, copy) {
      const target = get().target;
      const scope = target?.workspaceId ? directoryScope(target) : "";
      if (!scope || scope !== expectedScope)
        return Promise.reject(new Error("Project context recovery destination changed."));
      if (copy.kind === "saved-profile") {
        if (get().loading || get().profileError || !get().profileRevision)
          return Promise.reject(
            new Error("Load the destination's saved context before importing this file."),
          );
        return contextRecovery.importCopy(scope, {
          projectName: copy.projectName,
          capturedAt: copy.capturedAt,
          draft: copy.profile,
          base: canonicalProjectProfile(get().profile),
        });
      }
      return contextRecovery.importCopy(scope, copy);
    },
    restoreContextRecovery(snapshot) {
      const target = get().target;
      if (!target?.workspaceId || snapshot.scope !== directoryScope(target)) return;
      if (get().profileError || !get().profileRevision) return;
      const profile = canonicalProjectProfile(get().profile);
      const merged = mergeProjectProfile(snapshot.base, snapshot.draft, profile);
      contextDraftGeneration += 1;
      contextDrafts.write(target, {
        draft: merged.profile,
        base: profile,
        revision: get().profileRevision,
        conflicts: merged.conflicts,
      });
      contextRecovery.remember(snapshot.scope, merged.profile, profile, get().profileRevision);
      set({ contextDraft: merged.profile, contextConflicts: merged.conflicts });
    },
    discardContextRecovery(snapshot) {
      return contextRecovery.discard(snapshot);
    },
    discardUnreadableContextRecovery(expectedScope) {
      return contextRecovery.discardUnreadable(expectedScope);
    },
    discardContextDraft() {
      const target = get().target;
      if (!target?.workspaceId) return;
      contextDraftGeneration += 1;
      contextDrafts.write(target, null);
      void contextRecovery.forgetOwn(directoryScope(target));
      set({ contextDraft: null, contextConflicts: [] });
    },
    isCurrentContextRecovery(id) {
      return contextRecovery.isCurrent(id);
    },

    async runProjectSearch(query) {
      const generation = ++searchGeneration;
      set({ searchQuery: query, sessionSearchResults: [] });
      const workspaceId = get().target?.workspaceId;
      if (query && workspaceId && dataGateway?.searchSessions) {
        try {
          const response = await dataGateway.searchSessions(workspaceId, query);
          const results =
            (response as { results?: unknown[] })?.results ??
            (response as { sessions?: unknown[] })?.sessions ??
            [];
          if (generation === searchGeneration) set({ sessionSearchResults: results });
        } catch (reason) {
          if (generation !== searchGeneration) return;
          notify({
            title: t("Conversation search failed"),
            message: localizeHostError(reason).message,
            type: "error",
          });
        }
      }
    },

    openResult(result) {
      const kind = String(result.kind ?? result.type ?? "");
      if (kind === t("Note")) {
        window.dispatchEvent(
          new CustomEvent("zicode:open-note", {
            detail: { notebookId: result.notebookId, noteId: result.id ?? result.noteId },
          }),
        );
        return;
      }
      if (kind === t("Artifact")) {
        window.dispatchEvent(
          new CustomEvent("zicode:open-artifact", {
            detail: { artifactId: result.id ?? result.artifactId },
          }),
        );
        return;
      }
      if (kind === t("File")) {
        window.dispatchEvent(
          new CustomEvent("zicode:open-files", {
            detail: { path: result.path },
          }),
        );
        return;
      }
      if (kind === t("Conversation")) {
        const target = get().target;
        window.dispatchEvent(
          new CustomEvent("zicode:open-session", {
            detail: {
              sessionId: result.sessionId ?? result.id,
              workspaceId: target?.workspaceId ?? result.workspaceId,
              projectPath: target?.projectPath ?? result.projectPath,
            },
          }),
        );
      }
    },
  }));
  updateRecovery = (view) =>
    store.setState({
      contextRecoverySnapshots: view.snapshots,
      contextRecoveryUnreadable: view.unreadable,
      contextRecoveryRemovableUnreadable: view.removableUnreadable,
      contextRecoveryPending: view.pending,
      contextRecoveryError: view.error,
    });
  return store;
}

export function projectSearchMatches(
  snapshot: ProjectSnapshot,
  searchQuery: string,
  sessionSearchResults: unknown[],
) {
  const normalized = searchQuery.toLocaleLowerCase();
  return [
    ...snapshot.notes
      .filter((item) => searchable(item as unknown as Record<string, unknown>).includes(normalized))
      .map((item) => ({ ...item, kind: t("Note") })),
    ...snapshot.artifacts
      .filter((item) => searchable(item as unknown as Record<string, unknown>).includes(normalized))
      .map((item) => ({ ...item, kind: t("Artifact") })),
    ...snapshot.files
      .filter((item) => searchable(item as unknown as Record<string, unknown>).includes(normalized))
      .map((item) => ({ ...item, title: (item.name || item.path) as string, kind: t("File") })),
    ...sessionSearchResults.map((item) => {
      const record = item as Record<string, unknown>;
      return {
        ...record,
        title: (record.title || record.name || record.sessionId) as string,
        kind: t("Conversation"),
      };
    }),
  ].slice(0, 100);
}
