import { create } from "zustand";
import { t } from "../../shared/i18n.js";
import {
  emptyProjectSnapshot,
  projectWorkspaceKey,
  readProjectWorkspaceProfile,
  saveLocalProjectProfile,
  searchable,
  type KnowledgeSnapshot,
  type ProjectProfile,
  type ProjectSnapshot,
  type ProjectTarget,
} from "./logic";

export interface NotesGatewayLike {
  list?: (sceneId: string, workspaceId: string) => Promise<unknown>;
  knowledge?: (sceneId: string, workspaceId: string) => Promise<unknown>;
}

export interface ArtifactGatewayLike {
  list?: (sceneId: string, workspaceId: string) => Promise<unknown>;
}

export interface DataGatewayLike {
  listSessions?: (workspaceId: string) => Promise<unknown>;
  listFiles?: (workspaceId: string, root: string) => Promise<unknown>;
  searchSessions?: (workspaceId: string, query: string) => Promise<unknown>;
}

export interface ProjectWorkspaceOptions {
  notesGateway?: NotesGatewayLike;
  artifactGateway?: ArtifactGatewayLike;
  dataGateway?: DataGatewayLike;
  call?: (operation: string, params?: unknown) => Promise<{ ok?: boolean; error?: string; data?: unknown }>;
  getTarget?: () => ProjectTarget | null;
  storage?: Storage | null;
  openApp?: (pluginId: string) => void;
  onUseContextPack?: (notes: unknown[], options?: { compare?: boolean }) => void;
  notify?: (payload: { title: string; message?: string; type?: string }) => void;
}

export type ProjectView = "overview" | "context" | "knowledge" | "search" | "activity";

interface ProjectWorkspaceState {
  target: ProjectTarget | null;
  activeView: ProjectView;
  snapshot: ProjectSnapshot;
  loading: boolean;
  error: Error | null;
  profile: ProjectProfile;
  searchQuery: string;
  sessionSearchResults: unknown[];
  openApp(pluginId: string): void;
  onUseContextPack(notes: unknown[], options?: { compare?: boolean }): void;
  notify(payload: { title: string; message?: string; type?: string }): void;
  setTarget(target: ProjectTarget | null): void;
  setActiveView(view: ProjectView): void;
  load(): Promise<void>;
  loadProfile(): Promise<ProjectProfile>;
  saveProfile(nextProfile: ProjectProfile): Promise<ProjectProfile>;
  runProjectSearch(query: string): Promise<void>;
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
  const onUseContextPack = options.onUseContextPack ?? (() => {});

  const sceneId = () => getTarget()?.sceneId || "programming";
  const workspaceId = () => getTarget()?.workspaceId || "";

  return create<ProjectWorkspaceState>()((set, get) => ({
    target: getTarget(),
    activeView: "overview",
    snapshot: emptyProjectSnapshot(),
    loading: false,
    error: null,
    profile: readProjectWorkspaceProfile({ storage, target: getTarget() }),
    searchQuery: "",
    sessionSearchResults: [],

    openApp(pluginId) {
      openApp(pluginId);
    },

    onUseContextPack(notes, options) {
      onUseContextPack(notes, options);
    },

    notify(payload) {
      notify(payload);
    },

    setTarget(target) {
      const changed =
        projectWorkspaceKey(get().target) !==
        projectWorkspaceKey(target);
      set({ target });
      if (changed) {
        set({
          snapshot: emptyProjectSnapshot(),
          profile: readProjectWorkspaceProfile({ storage, target }),
        });
      }
      if (changed) void get().load();
    },

    setActiveView(view) {
      set({ activeView: view });
    },

    async load() {
      if (get().loading) return;
      set({ loading: true, error: null });
      const activeSceneId = sceneId();
      const activeWorkspaceId = workspaceId();
      const target = get().target;
      try {
        const [notes, artifacts, knowledge, loadedProfile, sessions, files] = await Promise.all([
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
            ? dataGateway?.listSessions?.(target.workspaceId).catch((reason) => ({ error: reason }))
            : { sessions: [] },
          target?.workspaceId
            ? dataGateway?.listFiles?.(target.workspaceId, "").catch((reason) => ({ error: reason }))
            : { files: [] },
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
        const sessionsAny = sessions as { sessions?: unknown[]; projects?: Array<{ sessions?: unknown[] }>; error?: unknown };
        const filesAny = files as { files?: unknown[]; entries?: unknown[]; error?: unknown };
        const snapshot: ProjectSnapshot = {
          notebooks: notesAny?.snapshot?.notebooks ?? [],
          notes: (notesAny?.snapshot?.notes ?? []) as ProjectSnapshot["notes"],
          artifacts: (artifactsAny?.snapshot?.artifacts ?? artifactsAny?.artifacts ?? []) as ProjectSnapshot["artifacts"],
          knowledge: {
            links: knowledgeAny?.snapshot?.links ?? [],
            similar: knowledgeAny?.snapshot?.similar ?? [],
            conflicts: knowledgeAny?.snapshot?.conflicts ?? [],
          },
          sessions: (sessionsAny?.sessions ?? sessionsAny?.projects?.[0]?.sessions ?? []) as ProjectSnapshot["sessions"],
          files: (filesAny?.files ?? filesAny?.entries ?? []) as ProjectSnapshot["files"],
          warnings: [
            notesAny?.error,
            artifactsAny?.error,
            knowledgeAny?.error,
            profileAny?.error,
            sessionsAny?.error,
            filesAny?.error,
          ].filter(Boolean),
        };
        set({ snapshot });
      } catch (reason) {
        set({ error: reason instanceof Error ? reason : new Error(String(reason)) });
      } finally {
        set({ loading: false });
      }
    },

    async loadProfile() {
      if (typeof call !== "function") return get().profile;
      const response = await call("read_project_profile");
      if (!response?.ok) {
        throw new Error(response?.error || t("Could not load project context"));
      }
      const profile = (response.data as { profile?: ProjectProfile })?.profile || get().profile;
      set({ profile });
      return profile;
    },

    async saveProfile(nextProfile) {
      if (typeof call === "function") {
        const response = await call("write_project_profile", { profile: nextProfile });
        if (!response?.ok) {
          throw new Error(response?.error || t("Could not save project context"));
        }
        const profile =
          (response.data as { profile?: ProjectProfile })?.profile || nextProfile;
        set({ profile });
        return profile;
      }
      saveLocalProjectProfile({ storage, target: get().target, profile: nextProfile });
      set({ profile: nextProfile });
      return nextProfile;
    },

    async runProjectSearch(query) {
      set({ searchQuery: query, sessionSearchResults: [] });
      const workspaceId = get().target?.workspaceId;
      if (query && workspaceId && dataGateway?.searchSessions) {
        try {
          const response = await dataGateway.searchSessions(workspaceId, query);
          const results =
            (response as { results?: unknown[] })?.results ??
            (response as { sessions?: unknown[] })?.sessions ??
            [];
          set({ sessionSearchResults: results });
        } catch (reason) {
          notify({
            title: t("Conversation search failed"),
            message: reason instanceof Error ? reason.message : String(reason),
            type: "error",
          });
        }
      }
    },
  }));
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
