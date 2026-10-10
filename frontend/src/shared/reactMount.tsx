import type { ErrorInfo, ReactNode } from "react";
// The app's vendored React bundle exports the full React object only as the
// default export; named exports cover hooks and helpers but NOT `Component`.
// Class components must therefore extend React.Component (default import).
import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { t } from "./i18n";

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render errors inside a plugin surface so a crashing view shows a
 * friendly message with a Retry action instead of leaving a blank area.
 * Resetting the boundary re-renders the children; apps that fail deterministically
 * surface their own store error UI on the retry.
 */
class PluginErrorBoundary extends React.Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[plugin-view] render crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="plugin-crash-fallback ui-card" role="alert">
          <p>{t("This view hit an unexpected error.")}</p>
          <button
            type="button"
            className="ui-button ui-button--primary ui-button--sm"
            onClick={() => this.setState({ hasError: false })}
          >
            {t("Retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  flushSync(() => root.render(<PluginErrorBoundary>{element}</PluginErrorBoundary>));
  return root;
}
