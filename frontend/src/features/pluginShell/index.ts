import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { PluginActivityBarApp } from "./PluginActivityBarApp";
import {
  createPluginShellBarStore,
  type PluginActivityItem,
  type PluginShellBarStore,
} from "./pluginShellStore";

export type {
  PluginActivityItem,
  PluginShellBarStore,
} from "./pluginShellStore";

export interface PluginActivityBarHandlers {
  onActivate(item: PluginActivityItem): void;
  onSystemActivate(item: PluginActivityItem): void;
  onMoreClick(): void;
  onBackdropClick(): void;
  onMenuClose(): void;
  onMenuItemClick(item: PluginActivityItem): void;
}

export interface PluginActivityBarApi {
  commit(patch: Partial<PluginShellBarStore>): void;
  getState(): PluginShellBarStore;
  getBar(): HTMLElement | null;
  destroy(): void;
}

export function setupPluginActivityBar({
  container,
  handlers,
}: {
  container: HTMLElement;
  handlers: PluginActivityBarHandlers;
}): PluginActivityBarApi {
  const store = createPluginShellBarStore();
  let root: Root | null = null;
  flushSync(() => {
    root = createRoot(container);
    root.render(
      createElement(PluginActivityBarApp, {
        store,
        onActivate: handlers.onActivate,
        onSystemActivate: handlers.onSystemActivate,
        onMoreClick: handlers.onMoreClick,
        onBackdropClick: handlers.onBackdropClick,
        onMenuClose: handlers.onMenuClose,
        onMenuItemClick: handlers.onMenuItemClick,
      }),
    );
  });
  return {
    commit(patch) {
      store.setState(patch);
      flushSync(() => {});
    },
    getState: () => store.getState(),
    getBar: () => container.querySelector(".plugin-activity-bar"),
    destroy() {
      root?.unmount();
    },
  };
}
