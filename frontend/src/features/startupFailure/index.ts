import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { StartupFailureApp } from "./StartupFailureApp";

let activeRoot: Root | null = null;
let activeWrapper: HTMLElement | null = null;

export function renderStartupFailure(
  error: { code?: string } | null | undefined,
  {
    documentRef = globalThis.document,
    reload = () => globalThis.location?.reload(),
  }: {
    documentRef?: Document;
    reload?: () => void;
  } = {},
): HTMLElement | null {
  if (!documentRef?.body) return null;
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  activeWrapper?.remove();
  activeWrapper = null;
  documentRef.querySelector("[data-startup-failure]")?.remove();
  documentRef.body.classList.add("startup-failed");
  for (const child of documentRef.body.children) {
    child.setAttribute("inert", "");
    child.setAttribute("aria-hidden", "true");
  }
  const code = error?.code || "startup_failed";

  const wrapper = documentRef.createElement("div");
  wrapper.dataset.startupFailureRoot = "";
  documentRef.body.append(wrapper);
  wrapper.removeAttribute("inert");
  wrapper.removeAttribute("aria-hidden");
  activeWrapper = wrapper;
  const root = createRoot(wrapper);
  activeRoot = root;
  flushSync(() => {
    root.render(
      createElement(StartupFailureApp, {
        code,
        onReload: reload,
      }),
    );
  });
  return wrapper.querySelector("[data-startup-failure]");
}
