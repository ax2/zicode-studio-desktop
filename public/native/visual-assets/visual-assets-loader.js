import { t } from "../../i18n.js";

// Keep the feature bundle and Host initialization off the shell startup path.
export function setupVisualAssetsApp({
  invoke,
  getTarget,
  load = () => import("../react/visual-assets.js"),
}) {
  let application;
  let loading;
  let activeContainer;
  let generation = 0;
  let destroyed = false;

  function deactivate() {
    generation += 1;
    activeContainer = undefined;
    application?.deactivate();
  }

  function renderContent(container) {
    if (destroyed) return;
    deactivate();
    activeContainer = container;
    const request = generation;
    const isCurrent = () => !destroyed && request === generation;
    if (application) {
      application.renderContent(container);
      return;
    }
    const status = document.createElement("div");
    status.className = "ui-card";
    status.setAttribute("role", "status");
    status.textContent = t("Loading visual assets…");
    container.replaceChildren(status);
    loading ??= Promise.resolve()
      .then(load)
      .catch((error) => {
        loading = undefined;
        throw error;
      });
    loading
      .then((module) => {
        if (!isCurrent()) return;
        application ??= module.setupVisualAssetsApp({ invoke, getTarget });
        application.renderContent(container);
      })
      .catch(() => {
        if (!isCurrent()) return;
        status.setAttribute("role", "alert");
        status.textContent = t("Could not load visual assets.");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "ui-button ui-button--secondary";
        retry.textContent = t("Retry");
        retry.addEventListener("click", () => {
          if (isCurrent()) renderContent(container);
        });
        status.append(retry);
        container.replaceChildren(status);
      });
  }

  return {
    renderContent,
    deactivate,
    setTarget() {
      if (activeContainer) application?.setTarget();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      activeContainer = undefined;
      application?.destroy();
      application = undefined;
    },
  };
}
