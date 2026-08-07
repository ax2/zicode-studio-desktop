import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";

export interface PluginActivityItem {
  id: string;
  label: string;
  icon: string;
  badge?: { count: number; tone: string } | null;
  system?: boolean;
  onClick?(): void;
}

export interface PluginShellBarStore {
  activities: PluginActivityItem[];
  systemItems: PluginActivityItem[];
  secondaryItems: PluginActivityItem[];
  activePluginId: string;
  mobileOpen: boolean;
  secondarySelected: boolean;
  moreLabel: string;
}

export type PluginShellBarStoreHook = UseBoundStore<
  StoreApi<PluginShellBarStore>
>;

export function createPluginShellBarStore(): PluginShellBarStoreHook {
  return create<PluginShellBarStore>()(() => ({
    activities: [],
    systemItems: [],
    secondaryItems: [],
    activePluginId: "core.chat",
    mobileOpen: false,
    secondarySelected: false,
    moreLabel: "More",
  }));
}
