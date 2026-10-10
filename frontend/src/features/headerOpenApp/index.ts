import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { HeaderOpenAppBridge } from "./HeaderOpenApp";
import {
  type InstalledApp,
  STORAGE_KEY,
} from "./headerOpenAppLogic";

export interface HeaderOpenAppOptions {
  data?: {
    workspaceInfo(
      workspaceId: string,
    ): Promise<{ info?: { path?: string } }>;
  };
  control?: {
    listInstalledApps(): Promise<InstalledApp[]>;
    openInApp(
      path: string,
      options: { appName?: string | null; command?: string | null },
    ): Promise<unknown>;
  };
  workspaceId?: string;
  onError?(error: Error): void;
}

interface HeaderOpenAppStore {
  apps: InstalledApp[];
  path: string;
  selectedId: string | null;
  menuOpen: boolean;
}

export function setupHeaderOpenApp({
  data,
  control,
  workspaceId,
  onError,
}: HeaderOpenAppOptions = {}): boolean {
  const root = document.getElementById("header-open-app");
  if (!root) return false;

  const store = create<HeaderOpenAppStore>()(() => ({
    apps: [],
    path: "",
    selectedId: localStorage.getItem(STORAGE_KEY) || null,
    menuOpen: false,
  }));

  const commit = (patch: Partial<HeaderOpenAppStore>) => {
    store.setState(patch);
    flushSync(() => {});
  };

  let appRoot: Root | null = null;
  flushSync(() => {
    appRoot = createRoot(root);
    appRoot.render(
      createElement(HeaderOpenAppBridge, {
        store,
        onButtonClick: () => openWorkspace(),
        onToggleClick: () => toggleMenu(),
        onItemClick: (app) => openWorkspace(app),
      }),
    );
  });

  const selectedApp = () =>
    store.getState().apps.find((app) => app.id === store.getState().selectedId) ||
    store.getState().apps[0] ||
    null;

  const refresh = () => {
    const state = store.getState();
    const app = selectedApp();
    if (!state.path || !app || state.apps.length === 0) {
      root.classList.add("hidden");
      return;
    }
    root.classList.remove("hidden");
    const button = document.getElementById("header-open-app-btn");
    if (button) {
      button.title = `Open ${state.path} in ${app.label}`;
      button.setAttribute("aria-label", `Open workspace in ${app.label}`);
    }
  };

  const closeMenu = () => commit({ menuOpen: false });

  const toggleMenu = () => {
    commit({ menuOpen: !store.getState().menuOpen });
  };

  const openWorkspace = async (app: InstalledApp | null = selectedApp()) => {
    const path = store.getState().path;
    if (!app || !path) return;
    commit({ selectedId: app.id });
    localStorage.setItem(STORAGE_KEY, app.id);
    refresh();
    try {
      await control?.openInApp(path, {
        appName: app.appName ?? null,
        command: app.command ?? null,
      });
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  document.addEventListener("click", closeMenu);

  Promise.all([
    (data?.workspaceInfo(workspaceId ?? "") ??
      Promise.resolve({ info: {} as { path?: string } })) as Promise<{
      info?: { path?: string };
    }>,
    control?.listInstalledApps() ?? Promise.resolve([]),
  ])
    .then(([workspace, apps]) => {
      const path = workspace?.info?.path || "";
      const appList = Array.isArray(apps) ? apps : [];
      commit({ path, apps: appList });
      refresh();
    })
    .catch((error) => onError?.(error instanceof Error ? error : new Error(String(error))));

  return true;
}
