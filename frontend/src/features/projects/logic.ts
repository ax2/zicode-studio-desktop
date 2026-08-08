import { t } from "../../shared/i18n.js";

export const PROJECT_WORKSPACE_STORAGE_KEY = "zicode.project-workspaces.v1";

export interface ProjectTarget {
  workspaceId?: string | null;
  workspaceName?: string | null;
  cwd?: string | null;
  projectPath?: string | null;
  sceneId?: string | null;
}

export interface ProjectProfile {
  instructions: string;
  defaultScene: string;
  budget: string;
}

export interface KnowledgeSnapshot {
  links: Array<{
    fromTitle: string;
    toTitle: string;
    kind?: string;
  }>;
  similar: Array<{
    leftTitle: string;
    rightTitle: string;
    leftNotebookId: string;
    leftNoteId: string;
    rightNotebookId: string;
    rightNoteId: string;
    sharedTags: string[];
    score: number;
  }>;
  conflicts: Array<{
    leftTitle: string;
    rightTitle: string;
    leftNotebookId: string;
    leftNoteId: string;
    rightNotebookId: string;
    rightNoteId: string;
    reason?: string;
  }>;
}

export interface ProjectSnapshot {
  notebooks: unknown[];
  notes: Array<{ id?: string; title?: string; summary?: string; excerpt?: string; updatedAt?: string; createdAt?: string }>;
  artifacts: Array<{ id?: string; title?: string; summary?: string; createdAt?: string; updatedAt?: string }>;
  sessions: Array<{ id?: string; title?: string }>;
  files: Array<{ name?: string; path?: string; summary?: string; snippet?: string }>;
  taskCount: number;
  automationCount: number;
  knowledge: KnowledgeSnapshot;
  warnings: unknown[];
}

export function emptyProjectSnapshot(): ProjectSnapshot {
  return {
    notebooks: [],
    notes: [],
    artifacts: [],
    sessions: [],
    files: [],
    taskCount: 0,
    automationCount: 0,
    knowledge: { links: [], similar: [], conflicts: [] },
    warnings: [],
  };
}

export function projectWorkspaceKey(target: ProjectTarget | null): string {
  return target?.workspaceId || target?.cwd || target?.projectPath || "default";
}

export function projectName(target: ProjectTarget | null): string {
  const path = target?.cwd || target?.projectPath || "";
  return (
    target?.workspaceName || path.split(/[\\/]/).filter(Boolean).at(-1) || t("Project workspace")
  );
}

export function defaultProjectProfile(target: ProjectTarget | null): ProjectProfile {
  return {
    instructions: "",
    defaultScene: target?.sceneId || "programming",
    budget: "",
  };
}

export function readProjectWorkspaceProfile({
  storage,
  target,
}: {
  storage?: Storage | null;
  target: ProjectTarget | null;
}): ProjectProfile {
  try {
    const state = JSON.parse(storage?.getItem(PROJECT_WORKSPACE_STORAGE_KEY) ?? "{}");
    return state?.version === 1 && state.projects?.[projectWorkspaceKey(target)]
      ? state.projects[projectWorkspaceKey(target)]
      : defaultProjectProfile(target);
  } catch {
    return defaultProjectProfile(target);
  }
}

export function saveLocalProjectProfile({
  storage,
  target,
  profile,
}: {
  storage?: Storage | null;
  target: ProjectTarget | null;
  profile: ProjectProfile;
}): void {
  let state: { version: number; projects: Record<string, ProjectProfile & { updatedAt: string }> } = {
    version: 1,
    projects: {},
  };
  try {
    const parsed = JSON.parse(storage?.getItem(PROJECT_WORKSPACE_STORAGE_KEY) ?? "{}");
    if (parsed?.version === 1 && parsed.projects) state = parsed;
  } catch {
    // Replace malformed optional UI state with a valid document.
  }
  state.projects[projectWorkspaceKey(target)] = {
    ...profile,
    updatedAt: new Date().toISOString(),
  };
  storage?.setItem(PROJECT_WORKSPACE_STORAGE_KEY, JSON.stringify(state));
}

export function searchable(item: Record<string, unknown>): string {
  return [item?.title, item?.name, item?.summary, item?.excerpt, item?.path]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}
