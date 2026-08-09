import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import {
  PluginManagerViewApp,
  type PluginManagerRegistry,
} from "./PluginManagerViewApp";
import type { PluginManagerFilter } from "./pluginManagerLogic";

let activeRoot: Root | null = null;
let activeWrapper: HTMLElement | null = null;

export interface PluginManagerViewOptions {
  container: HTMLElement;
  registry: PluginManagerRegistry;
  getTarget?(): { sceneId?: string } | null;
  notify?(message: string): void;
  renderIcon?(icon: string | undefined): HTMLElement;
  installDeveloperPlugin?: (() => Promise<string | null | undefined>) | null;
  selectSignedPlugin?: (() => Promise<
    | {
        packagePath: string;
        publisher: string;
        publisherKeyId?: string;
        permissions?: string[];
        trusted?: boolean;
      }
    | null
    | undefined
  >) | null;
  installSignedPlugin?: ((
    packagePath: string,
    requireConfirmation: boolean,
  ) => Promise<string | null | undefined>) | null;
  rollbackSignedPlugin?: ((id: string, version: string) => Promise<unknown>) | null;
  revokePublisher?: ((publisherKeyId: string) => Promise<unknown>) | null;
  initialFilter?: PluginManagerFilter;
  onFilterChange?(filter: PluginManagerFilter): void;
  confirmUninstall?(message: string): boolean | Promise<boolean>;
  confirmPublisher?(message: string): boolean | Promise<boolean>;
}

export function renderPluginManagerView(options: PluginManagerViewOptions): void {
  const { container, ...rest } = options;
  if (activeRoot) {
    // Mount into a dedicated wrapper so an earlier plugin-shell
    // replaceChildren() (which detaches the wrapper, not its children) never
    // leaves React unable to unmount its own nodes.
    activeRoot.unmount();
    activeRoot = null;
  }
  activeWrapper?.remove();
  const wrapper = document.createElement("div");
  wrapper.dataset.pluginManagerRoot = "";
  container.append(wrapper);
  activeWrapper = wrapper;
  const root = createRoot(wrapper);
  activeRoot = root;
  flushSync(() => {
    root.render(
      createElement(PluginManagerViewApp, {
        registry: rest.registry,
        getTarget: rest.getTarget,
        notify: rest.notify,
        renderIcon: rest.renderIcon,
        installDeveloperPlugin: rest.installDeveloperPlugin,
        selectSignedPlugin: rest.selectSignedPlugin,
        installSignedPlugin: rest.installSignedPlugin,
        rollbackSignedPlugin: rest.rollbackSignedPlugin,
        revokePublisher: rest.revokePublisher,
        initialFilter: rest.initialFilter,
        onFilterChange: rest.onFilterChange,
        confirmUninstall: rest.confirmUninstall,
        confirmPublisher: rest.confirmPublisher,
      }),
    );
  });
}
