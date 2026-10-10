import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { PluginActivityBarApp } from "./PluginActivityBarApp";
import {
  createMainShellStore,
  PluginMainShellBridge,
  type PluginMainShellStoreHook,
} from "./PluginMainShellApp";
import { type PluginAccordion, PluginSidebarShell } from "./PluginSidebarShellApp";
import {
  createPluginShellBarStore,
  type PluginActivityItem,
  type PluginShellBarStore,
} from "./pluginShellStore";

export type { PluginAccordion } from "./PluginSidebarShellApp";
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

export interface PluginSidebarShellProps {
  title: string;
  accordions: PluginAccordion[];
  project?: { name: string; path?: string } | null;
}

export interface PluginMainShellProps {
  plugin: { id: string; name: string; description: string; origin: string };
  target: { sceneId?: string; sceneName?: string } | null;
  previewStatus: string;
  onOpenWorkbench(): void;
  onOpenConfiguration(): void;
}

export interface PluginShellSurfacesApi {
  mountSidebar(container: HTMLElement, props: PluginSidebarShellProps): void;
  mountMain(container: HTMLElement, props: PluginMainShellProps): void;
  setPreviewStatus(text: string): void;
  destroy(): void;
}

export function setupPluginShellSurfaces(): PluginShellSurfacesApi {
  let sidebarRoot: Root | null = null;
  let mainRoot: Root | null = null;
  let mainStore: PluginMainShellStoreHook | null = null;

  const unmountSidebar = () => {
    sidebarRoot?.unmount();
    sidebarRoot = null;
  };
  const unmountMain = () => {
    mainRoot?.unmount();
    mainRoot = null;
    mainStore = null;
  };

  return {
    mountSidebar(container, props) {
      unmountSidebar();
      const root = createRoot(container);
      sidebarRoot = root;
      flushSync(() => {
        root.render(
          createElement(PluginSidebarShell, {
            title: props.title,
            accordions: props.accordions,
            project: props.project,
          }),
        );
      });
    },
    mountMain(container, props) {
      unmountMain();
      const store = createMainShellStore(props.previewStatus);
      mainStore = store;
      const root = createRoot(container);
      mainRoot = root;
      flushSync(() => {
        root.render(
          createElement(PluginMainShellBridge, {
            store,
            plugin: props.plugin,
            target: props.target,
            onOpenWorkbench: props.onOpenWorkbench,
            onOpenConfiguration: props.onOpenConfiguration,
          }),
        );
      });
    },
    setPreviewStatus(text) {
      mainStore?.getState().setPreviewStatus(text);
      flushSync(() => {});
    },
    destroy() {
      unmountSidebar();
      unmountMain();
    },
  };
}
