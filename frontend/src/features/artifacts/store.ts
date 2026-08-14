import { create } from "zustand";
import { t } from "../../shared/i18n.js";
import { localizeHostError } from "../../shared/hostErrors.js";
import {
  defaultDownloadFile,
  EMPTY_ARTIFACT_SNAPSHOT,
  safeFileName,
  type ArtifactDescriptor,
  type ArtifactDocument,
} from "./logic";

export interface ArtifactGatewayLike {
  list(
    sceneId: string,
    workspaceId: string,
    filters: { query?: string; kind?: string; pluginId?: string },
  ): Promise<{ snapshot?: { artifacts?: ArtifactDescriptor[]; kinds?: string[]; plugins?: string[] } }>;
  get(sceneId: string, workspaceId: string, artifactId: string): Promise<{ artifact?: ArtifactDocument }>;
  importAll(sceneId: string, workspaceId: string, artifacts: unknown[]): Promise<{ imported?: number }>;
  delete(sceneId: string, workspaceId: string, artifact: ArtifactDescriptor): Promise<unknown>;
}

export interface ArtifactAppOptions {
  gateway: ArtifactGatewayLike;
  getTarget?: () => { sceneId?: string; workspaceId?: string } | null;
  notify?: (message: string) => void;
  confirmDelete?: (message: string) => boolean | Promise<boolean>;
  downloadFile?: (fileName: string, content: string, type: string) => void;
  chooseFile?: (accept: string) => Promise<File | null>;
}

interface ArtifactSnapshot {
  artifacts: ArtifactDescriptor[];
  kinds: string[];
  plugins: string[];
}

interface ArtifactState {
  snapshot: ArtifactSnapshot;
  selected: ArtifactDocument | null;
  loading: boolean;
  error: Error | null;
  query: string;
  kind: string;
  pluginId: string;
  setQuery(query: string): void;
  setKind(kind: string): void;
  setPluginId(pluginId: string): void;
  load(options?: { preserveSelection?: boolean }): Promise<void>;
  selectArtifact(descriptor: ArtifactDescriptor): Promise<void>;
  openArtifact(artifactId: string): Promise<void>;
  deleteSelected(): Promise<void>;
  exportSelected(): boolean;
  exportAll(): Promise<void>;
  importAll(): Promise<void>;
  setTarget(): void;
  destroy(): void;
}

function defaultChooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    document.body.append(input);
    input.click();
  });
}

export function createArtifactStore(options: ArtifactAppOptions) {
  const gateway = options.gateway;
  const getTarget = options.getTarget ?? (() => null);
  const notify = options.notify ?? (() => {});
  const confirmDelete = options.confirmDelete ?? ((message: string) => globalThis.confirm?.(message) ?? false);
  const downloadFile = options.downloadFile ?? defaultDownloadFile;
  const chooseFile = options.chooseFile ?? defaultChooseFile;
  let requestSequence = 0;

  const sceneId = () => getTarget()?.sceneId ?? "programming";
  const workspaceId = () => getTarget()?.workspaceId ?? "";

  return create<ArtifactState>()((set, get) => ({
    snapshot: { ...EMPTY_ARTIFACT_SNAPSHOT },
    selected: null,
    loading: false,
    error: null,
    query: "",
    kind: "",
    pluginId: "",

    setQuery(query) {
      set({ query });
    },
    setKind(kind) {
      set({ kind });
    },
    setPluginId(pluginId) {
      set({ pluginId });
    },

    async load({ preserveSelection = true } = {}) {
      const requestId = ++requestSequence;
      const activeSceneId = sceneId();
      const activeWorkspaceId = workspaceId();
      set({ loading: true, error: null });
      try {
        const response = await gateway.list(activeSceneId, activeWorkspaceId, {
          query: get().query,
          kind: get().kind,
          pluginId: get().pluginId,
        });
        if (
          requestId !== requestSequence ||
          activeSceneId !== sceneId() ||
          activeWorkspaceId !== workspaceId()
        ) {
          return;
        }
        const snapshot = {
          artifacts: response.snapshot?.artifacts ?? [],
          kinds: response.snapshot?.kinds ?? [],
          plugins: response.snapshot?.plugins ?? [],
        };
        const selected = get().selected;
        if (
          !preserveSelection ||
          (selected && !snapshot.artifacts.some((artifact) => artifact.id === selected.id))
        ) {
          set({ snapshot, selected: null });
        } else {
          set({ snapshot });
        }
      } catch (loadError) {
        if (requestId === requestSequence) {
          set({
            error: localizeHostError(
              loadError instanceof Error ? loadError : new Error(String(loadError)),
            ),
          });
        }
      } finally {
        if (requestId === requestSequence) set({ loading: false });
      }
    },

    async selectArtifact(descriptor) {
      const requestId = ++requestSequence;
      set({ loading: true, error: null });
      try {
        const response = await gateway.get(sceneId(), workspaceId(), descriptor.id);
        if (requestId !== requestSequence) return;
        set({ selected: response.artifact ?? null });
      } catch (loadError) {
        if (requestId === requestSequence) {
          set({
            error: localizeHostError(
              loadError instanceof Error ? loadError : new Error(String(loadError)),
            ),
          });
        }
      } finally {
        if (requestId === requestSequence) set({ loading: false });
      }
    },

    async openArtifact(artifactId) {
      const requestId = ++requestSequence;
      set({ loading: true, error: null });
      try {
        const response = await gateway.get(sceneId(), workspaceId(), artifactId);
        if (requestId !== requestSequence) return;
        set({ selected: response.artifact ?? null });
      } catch (loadError) {
        if (requestId === requestSequence) {
          set({
            error: localizeHostError(
              loadError instanceof Error ? loadError : new Error(String(loadError)),
            ),
          });
        }
      } finally {
        if (requestId === requestSequence) set({ loading: false });
      }
    },

    async deleteSelected() {
      const selected = get().selected;
      if (!selected || !(await confirmDelete(`${t("Delete artifact")} “${selected.title}”?`)))
        return;
      set({ loading: true, error: null });
      try {
        await gateway.delete(sceneId(), workspaceId(), selected);
        const deletedTitle = selected.title;
        set({ selected: null });
        await get().load({ preserveSelection: false });
        notify(`${t("Artifact deleted")}: ${deletedTitle}`);
      } catch (deleteError) {
        set({
          error: localizeHostError(
            deleteError instanceof Error ? deleteError : new Error(String(deleteError)),
          ),
          loading: false,
        });
      }
    },

    exportSelected() {
      const selected = get().selected;
      if (!selected) {
        notify(t("Select an artifact to export"));
        return false;
      }
      downloadFile(
        `${safeFileName(selected.title)}.zicode-artifact.json`,
        `${JSON.stringify({ schemaVersion: 1, artifact: selected }, null, 2)}\n`,
        "application/json",
      );
      notify(t("Artifact exported"));
      return true;
    },

    async exportAll() {
      const artifacts = get().snapshot.artifacts;
      if (artifacts.length === 0) {
        notify(t("No artifacts to export"));
        return;
      }
      const documents = [];
      for (const descriptor of artifacts) {
        try {
          const response = await gateway.get(
            sceneId(),
            workspaceId(),
            descriptor.id,
          );
          if (response.artifact) {
            documents.push(response.artifact);
          }
        } catch {
          // Skip artifacts that cannot be read; the bundle still exports the
          // ones that succeeded. All-failure is handled below.
        }
      }
      if (documents.length === 0) {
        notify(t("Could not export artifacts"));
        return;
      }
      downloadFile(
        `zicode-artifacts-all-${workspaceId().slice(0, 8)}.json`,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            artifacts: documents,
          },
          null,
          2,
        )}\n`,
        "application/json",
      );
      notify(t("All artifacts exported"));
    },

    async importAll() {
      try {
        const file = await chooseFile(".json");
        if (!file) return;
        if (!file.size || file.size > 70 * 1024 * 1024) {
          notify(t("Artifact bundle exceeds the 70 MiB limit"));
          return;
        }
        const bundle = JSON.parse(await file.text());
        if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
          notify(t("Artifact bundle is not valid JSON"));
          return;
        }
        const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
        await gateway.importAll(sceneId(), workspaceId(), artifacts);
        await get().load({ preserveSelection: false });
        notify(t("All artifacts imported"));
      } catch (error) {
        notify(
          error instanceof SyntaxError
            ? t("Artifact bundle is not valid JSON")
            : t("Could not import artifacts"),
        );
      }
    },

    setTarget() {
      requestSequence += 1;
      set({
        selected: null,
        snapshot: { ...EMPTY_ARTIFACT_SNAPSHOT },
        error: null,
        loading: false,
      });
    },

    destroy() {
      requestSequence += 1;
    },
  }));
}
