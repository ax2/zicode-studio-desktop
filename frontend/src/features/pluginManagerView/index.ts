import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  type PluginManagerRegistry,
  type DeveloperPluginPreview,
  PluginManagerViewApp,
} from "./PluginManagerViewApp";
import type { SignedPluginPreview } from "./SignedPluginPreviewCard";
import type { PluginManagerFilter } from "./pluginManagerLogic";

let activeRoot: Root | null = null;
let activeWrapper: HTMLElement | null = null;
let activeRegistry: PluginManagerRegistry | null = null;
let activeScope: string | null = null;

export interface PluginManagerViewOptions {
  container: HTMLElement;
  registry: PluginManagerRegistry;
  canManagePlugins?: boolean;
  getTarget?(): { sceneId?: string; workspaceId?: string } | null;
  preserveState?: boolean;
  notify?(message: string): void;
  renderIcon?(icon: string | undefined): HTMLElement;
  selectDeveloperPlugin?: (() => Promise<DeveloperPluginPreview | null | undefined>) | null;
  installDeveloperPlugin?: ((sourcePath: string, contentSha256: string) => Promise<string | null | undefined>) | null;
  selectSignedPlugin?: (() => Promise<SignedPluginPreview | null | undefined>) | null;
  installSignedPlugin?: ((
    packagePath: string,
    manifestSha256: string,
    requireConfirmation: boolean,
  ) => Promise<string | null | undefined>) | null;
  rollbackSignedPlugin?: ((id: string, version: string) => Promise<unknown>) | null;
  revokePublisher?: ((publisherKeyId: string) => Promise<unknown>) | null;
  initialFilter?: PluginManagerFilter;
  onFilterChange?(filter: PluginManagerFilter): void;
  confirmUninstall?(message: string): boolean | Promise<boolean>;
  confirmPublisher?(message: string): boolean | Promise<boolean>;
  openHelp?(pageId: string): void;
}

export function renderPluginManagerView(options: PluginManagerViewOptions): void {
  const { container, ...rest } = options;
  const target = rest.getTarget?.();
  const scope = JSON.stringify([target?.sceneId ?? "programming", target?.workspaceId ?? null]);
  const retain = rest.preserveState && activeRoot && activeWrapper?.parentNode === container &&
    activeRegistry === rest.registry && activeScope === scope;
  if (!retain) {
    // Keep the dedicated wrapper so unmount is safe after the shell detaches it.
    activeRoot?.unmount();
    activeWrapper?.remove();
    container.replaceChildren();
    const wrapper = document.createElement("div");
    wrapper.dataset.pluginManagerRoot = "";
    container.append(wrapper);
    activeWrapper = wrapper;
    activeRoot = createRoot(wrapper);
    activeRegistry = rest.registry;
    activeScope = scope;
  }
  const root = activeRoot;
  if (!root) return;
  flushSync(() => {
    root.render(
      createElement(PluginManagerViewApp, {
        registry: rest.registry,
        canManagePlugins: rest.canManagePlugins,
        getTarget: rest.getTarget,
        notify: rest.notify,
        renderIcon: rest.renderIcon,
        selectDeveloperPlugin: rest.selectDeveloperPlugin,
        installDeveloperPlugin: rest.installDeveloperPlugin,
        selectSignedPlugin: rest.selectSignedPlugin,
        installSignedPlugin: rest.installSignedPlugin,
        rollbackSignedPlugin: rest.rollbackSignedPlugin,
        revokePublisher: rest.revokePublisher,
        openHelp: rest.openHelp,
        initialFilter: rest.initialFilter,
        onFilterChange: rest.onFilterChange,
        confirmUninstall: rest.confirmUninstall,
        confirmPublisher: rest.confirmPublisher,
      }),
    );
  });
}
