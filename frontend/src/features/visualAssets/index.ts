import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

export function setupVisualAssetsApp({
  invoke,
  getTarget,
}: {
  invoke?: Invoke;
  getTarget: () => { workspaceId?: string; sceneId?: string } | null;
}) {
  let root: Root | null = null;
  let workspaceId = "";
  let sceneId = "";
  function render() {
    const target = getTarget();
    workspaceId = target?.workspaceId ?? "";
    sceneId = target?.sceneId ?? "";
    if (invoke)
      root?.render(
        createElement(VisualAssetsApp, { key: workspaceId, invoke, workspaceId, sceneId }),
      );
  }
  function deactivate() {
    root?.unmount();
    root = null;
  }
  return {
    renderContent(container: HTMLElement) {
      deactivate();
      const wrapper = document.createElement("div");
      wrapper.className = "visual-assets-root";
      container.replaceChildren(wrapper);
      root = createRoot(wrapper);
      render();
    },
    setTarget() {
      const target = getTarget();
      if (workspaceId !== (target?.workspaceId ?? "") || sceneId !== (target?.sceneId ?? ""))
        render();
    },
    deactivate,
    destroy: deactivate,
  };
}
