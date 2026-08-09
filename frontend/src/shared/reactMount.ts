import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { ReactNode } from "react";

/**
 * Mounts a React tree into a plugin-shell surface container.
 *
 * The plugin shell clears the shared sidebar/main containers with
 * `replaceChildren()` on every activation, which orphans any React root that
 * was created directly on that container; reusing such a root on the next
 * activation throws `NotFoundError` during commit and renders nothing. Mount
 * into a fresh wrapper element instead and unmount the previous root first
 * (the old wrapper is detached, so unmounting is always safe).
 */
export function mountPluginSurface(
  container: HTMLElement,
  element: ReactNode,
  previousRoot: Root | null,
): Root {
  previousRoot?.unmount();
  // The plugin shell prepends shell-owned chrome (project row, plugin title)
  // before an application mounts its navigation/content. Clear only this
  // app's own previous mount instead of the whole container, so that chrome
  // survives activation and every application shows the project consistently.
  container.querySelector(":scope > .plugin-app-mount")?.remove();
  const wrapper = document.createElement("div");
  wrapper.className = "plugin-app-mount";
  container.append(wrapper);
  const root = createRoot(wrapper);
  flushSync(() => root.render(element));
  return root;
}
