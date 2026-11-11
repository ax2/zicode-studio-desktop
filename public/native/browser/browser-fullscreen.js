import { t } from "../../i18n.js";

export function createBrowserFullscreen({ control, beforeChange = () => {}, afterChange = () => {}, report = () => {} }) {
  let fullscreen = false, pending = null, generation = 0, timer;
  const button = document.createElement("button"); button.type = "button";
  button.className = "ui-button ui-button--secondary browser-fullscreen-toggle"; button.setAttribute("aria-keyshortcuts", "F11");
  const exit = document.createElement("button"); exit.type = "button";
  exit.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost browser-fullscreen-exit";
  exit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3v5H3m13-5v5h5M8 21v-5H3m13 5v-5h5"/></svg>';
  function paint() {
    button.textContent = t(fullscreen ? "Exit fullscreen" : "Enter fullscreen"); button.title = `${button.textContent} (F11)`;
    button.disabled = exit.disabled = Boolean(pending); button.setAttribute("aria-pressed", String(fullscreen));
    exit.hidden = !fullscreen; exit.title = `${t("Exit fullscreen")} (F11)`; exit.setAttribute("aria-label", t("Exit fullscreen"));
  }
  function apply(result) {
    if (typeof result?.fullscreen !== "boolean") throw new Error(t("Could not read fullscreen state."));
    fullscreen = result.fullscreen; paint();
  }
  async function refresh() {
    if (pending) return;
    const current = ++generation;
    try { const result = await control({ kind: "fullscreen" }); if (current === generation && !pending) apply(result); }
    catch (error) { if (current === generation) report(error); }
  }
  function change(enabled) {
    if (pending) return pending;
    generation++; beforeChange();
    pending = (async () => {
      const before = await control({ kind: "fullscreen" }); apply(before);
      const target = enabled ?? !before.fullscreen;
      if (target !== before.fullscreen) apply(await control({ kind: "fullscreen", enabled: target }));
      await afterChange();
    })().finally(() => { pending = null; paint(); });
    paint(); return pending;
  }
  button.addEventListener("click", () => void change().catch(report)); exit.addEventListener("click", () => void change(false).catch(report));
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 80); });
  window.addEventListener("zicode:locale-changed", paint); paint();
  return { element: button, exit, refresh, toggle: () => change(), async leave() { await pending; if (fullscreen) await change(false); } };
}
