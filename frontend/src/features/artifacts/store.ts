import { create } from "zustand";
import { t } from "../../shared/i18n.js";
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
    filters: { query?: string; kind?: string; pluginId?: string },
  ): Promise<{ snapshot?: { artifacts?: ArtifactDescriptor[]; kinds?: string[]; plugins?: string[] } }>;
  get(sceneId: string, artifactId: string): Promise<{ artifact?: ArtifactDocument }>;
  delete(sceneId: string, artifact: ArtifactDescriptor): Promise<unknown>;
}

export interface ArtifactAppOptions {
  gateway: ArtifactGatewayLike;
  getTarget?: () => { sceneId?: string } | null;
  notify?: (message: string) => void;
  confirmDelete?: (message: string) => boolean;
  downloadFile?: (fileName: string, content: string, type: string) => void;
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
  deleteSelected(): Promise<void>;
  exportSelected(): boolean;
  setTarget(): void;
  destroy(): void;
}

export function createArtifactStore(options: ArtifactAppOptions) {
  const gateway = options.gateway;
  const getTarget = options.getTarget ?? (() => null);
  const notify = options.notify ?? (() => {});
  const confirmDelete = options.confirmDelete ?? ((message: string) => globalThis.confirm?.(message) ?? false);
  const downloadFile = options.downloadFile ?? defaultDownloadFile;
  let requestSequence = 0;

  const sceneId = () => getTarget()?.sceneId ?? "programming";

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
      set({ loading: true, error: null });
      try {
        const response = await gateway.list(activeSceneId, {
          query: get().query,
          kind: get().kind,
          pluginId: get().pluginId,
        });
        if (requestId !== requestSequence || activeSceneId !== sceneId()) return;
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
          set({ error: loadError instanceof Error ? loadError : new Error(String(loadError)) });
        }
      } finally {
        if (requestId === requestSequence) set({ loading: false });
      }
    },

    async selectArtifact(descriptor) {
      const requestId = ++requestSequence;
      set({ loading: true, error: null });
      try {
        const response = await gateway.get(sceneId(), descriptor.id);
        if (requestId !== requestSequence) return;
        set({ selected: response.artifact ?? null });
      } catch (loadError) {
        if (requestId === requestSequence) {
          set({ error: loadError instanceof Error ? loadError : new Error(String(loadError)) });
        }
      } finally {
        if (requestId === requestSequence) set({ loading: false });
      }
    },

    async deleteSelected() {
      const selected = get().selected;
      if (!selected || !confirmDelete(`${t("Delete artifact")} “${selected.title}”?`)) return;
      set({ loading: true, error: null });
      try {
        await gateway.delete(sceneId(), selected);
        const deletedTitle = selected.title;
        set({ selected: null });
        await get().load({ preserveSelection: false });
        notify(`${t("Artifact deleted")}: ${deletedTitle}`);
      } catch (deleteError) {
        set({
          error: deleteError instanceof Error ? deleteError : new Error(String(deleteError)),
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
