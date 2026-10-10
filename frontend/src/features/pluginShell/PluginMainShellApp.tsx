import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";
import { PluginMainShell } from "./PluginSidebarShellApp";

export type { PluginMainShell };

export interface PluginMainShellStore {
  previewStatus: string;
  setPreviewStatus(text: string): void;
}

export type PluginMainShellStoreHook = UseBoundStore<
  StoreApi<PluginMainShellStore>
>;

export function createMainShellStore(initialStatus: string) {
  return create<PluginMainShellStore>()((set) => ({
    previewStatus: initialStatus,
    setPreviewStatus: (previewStatus) => set({ previewStatus }),
  }));
}

export function PluginMainShellBridge({
  store,
  plugin,
  target,
  onOpenWorkbench,
  onOpenConfiguration,
}: {
  store: PluginMainShellStoreHook;
  plugin: { id: string; name: string; description: string; origin: string };
  target: { sceneId?: string; sceneName?: string } | null;
  onOpenWorkbench(): void;
  onOpenConfiguration(): void;
}) {
  const previewStatus = store((state) => state.previewStatus);
  return (
    <PluginMainShell
      plugin={plugin}
      target={target}
      previewStatus={previewStatus}
      onOpenWorkbench={onOpenWorkbench}
      onOpenConfiguration={onOpenConfiguration}
    />
  );
}
