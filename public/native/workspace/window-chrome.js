import { t } from "../../i18n.js";

const paths = {
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  restore: '<path d="M9 5V3h12v12h-2"/><rect x="3" y="9" width="12" height="12" rx="1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export function setupWindowChrome({ doc = document, invoke = globalThis.__TAURI__?.core?.invoke, report = () => {} } = {}) {
  const header = doc.querySelector(".session-header");
  const layout = header?.closest(".app-layout");
  if (!invoke || !layout) return;
  const view = doc.defaultView;
  const slot = doc.createElement("div"); slot.className = "window-controls-slot";
  slot.setAttribute("aria-hidden", "true");
  const grip = doc.createElement("div"); grip.className = "window-drag-handle"; grip.dataset.windowDrag = ""; grip.setAttribute("aria-hidden", "true");
  const group = doc.createElement("div"); group.className = "window-controls"; group.setAttribute("role", "group");
  let maximized = false, fullscreen = false, busy = false, revision = 0, timer;
  const buttons = {};
  const control = action => invoke("desktop_window_control", { action });
  const draw = () => {
    group.setAttribute("aria-label", t("Window controls"));
    grip.title = t("Drag to move window");
    for (const [action, button] of Object.entries(buttons)) {
      const label = action === "minimize" ? "Minimize window" : action === "close" ? "Close window" : maximized || fullscreen ? "Restore window" : "Maximize window";
      button.title = t(label); button.setAttribute("aria-label", t(label));
      const icon = action === "toggleMaximize" ? maximized || fullscreen ? "restore" : "maximize" : action;
      button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${paths[icon]}</svg>`;
    }
  };
  const refresh = async () => {
    const token = ++revision;
    try { const state = await control("state"); if (token !== revision) return; maximized = state.maximized; fullscreen = state.fullscreen; draw(); }
    catch (error) { report(error); }
  };
  const act = async action => {
    if (busy) return;
    busy = true; ++revision;
    try { await control(action); await refresh(); }
    catch (error) { report(error); }
    finally { busy = false; }
  };
  for (const action of ["minimize", "toggleMaximize", "close"]) {
    const button = doc.createElement("button"); button.type = "button";
    button.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost window-control";
    button.dataset.windowAction = action; buttons[action] = button;
    button.addEventListener("click", () => void act(action)); group.append(button);
  }
  // Reserve space in the toolbar while layering the controls above the drawer.
  header.append(grip, slot);
  layout.append(group);
  const positionControls = () => {
    const bounds = slot.getBoundingClientRect();
    const rtl = view.getComputedStyle(slot).direction === "rtl";
    group.style.insetBlockStart = `${bounds.top}px`;
    group.style.insetInlineEnd = `${rtl ? bounds.left : view.innerWidth - bounds.right}px`;
  };
  const geometry = view.ResizeObserver && new view.ResizeObserver(positionControls);
  geometry?.observe(header);
  geometry?.observe(slot);
  positionControls();
  draw();
  void refresh();
  const draggable = event => event.button === 0 && (event.target === header || event.target.closest("[data-window-drag]"));
  const down = event => { if (draggable(event) && event.detail === 1) void control("drag").catch(report); };
  const doubleClick = event => { if (draggable(event)) void act("toggleMaximize"); };
  const resize = () => {
    positionControls();
    clearTimeout(timer);
    timer = setTimeout(refresh, 80);
  };
  header.addEventListener("mousedown", down);
  header.addEventListener("dblclick", doubleClick);
  view.addEventListener("resize", resize);
  view.visualViewport?.addEventListener("resize", positionControls);
  view.visualViewport?.addEventListener("scroll", positionControls);
  view.addEventListener("zicode:locale-changed", draw);
  return {
    refresh,
    dispose() {
      clearTimeout(timer);
      ++revision;
      geometry?.disconnect();
      group.remove();
      slot.remove();
      grip.remove();
      header.removeEventListener("mousedown", down);
      header.removeEventListener("dblclick", doubleClick);
      view.removeEventListener("resize", resize);
      view.visualViewport?.removeEventListener("resize", positionControls);
      view.visualViewport?.removeEventListener("scroll", positionControls);
      view.removeEventListener("zicode:locale-changed", draw);
    },
  };
}
