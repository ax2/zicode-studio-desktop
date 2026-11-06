import { t } from "../../i18n.js";
export const zoomSteps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
export function nextPageZoom(current, direction) {
  return direction > 0 ? zoomSteps.find(value => value > current + 0.001) ?? 5 : [...zoomSteps].reverse().find(value => value < current - 0.001) ?? 0.25;
}
export async function applyBrowserPageSetting({ change, read, write, persist }) {
  const before = await read();
  const after = await write(change);
  try { await persist(after); }
  catch (error) {
    try { await write({ kind: change.kind, value: before[change.kind] }); }
    catch { throw new Error(t("Page setting could not be saved or restored. Reopen the menu to check it.")); }
    throw error;
  }
  return after;
}
export function createBrowserPageControls({ getTab, read, change }) {
  let current = null, generation = 0, busy = false;
  const group = document.createElement("fieldset");group.className = "browser-page-controls";group.setAttribute("aria-label", t("Page controls"));
  const row = document.createElement("div");row.className = "browser-zoom-row";
  const label = document.createElement("span");label.textContent = t("Page zoom");
  const message = document.createElement("p");message.className = "browser-page-controls-status";message.setAttribute("role", "status");
  const button = (text, name, action) => {
    const button = document.createElement("button");button.type = "button";button.className = "ui-button ui-button--secondary";button.textContent = text;button.title = t(name);button.setAttribute("aria-label", t(name));
    button.addEventListener("click", () => void run(action));return button;
  };
  async function run(action) {
    if (busy || !current) return;const selected = current;
    busy = true;group.disabled = true;message.textContent = "";
    try { await change(selected.id, action(selected)); }
    catch (error) { message.textContent = t(String(error?.message ?? error)); }
    finally { busy = false;await refresh(false); }
  }
  const smaller = button("−", "Zoom out", tab => ({ kind: "zoom", value: nextPageZoom(tab.zoom, -1) }));
  const reset = button("100%", "Reset page zoom", () => ({ kind: "zoom", value: 1 }));
  const larger = button("+", "Zoom in", tab => ({ kind: "zoom", value: nextPageZoom(tab.zoom, 1) }));
  const mute = button(t("Mute tab"), "Mute tab", tab => ({ kind: "muted", value: !tab.muted }));
  async function refresh(clear = true) {
    const request = ++generation, tab = getTab();current = null;group.disabled = true;
    if (clear) message.textContent = "";
    if (!tab) { reset.textContent = "100%";return; }
    try {
      const settings = await read(tab.id);
      if (request !== generation || getTab()?.id !== tab.id) return;
      current = { id: tab.id, ...settings };
      reset.textContent = `${Math.round(settings.zoom * 100)}%`;smaller.disabled = settings.zoom <= 0.25;larger.disabled = settings.zoom >= 5;
      mute.textContent = t(settings.muted ? "Unmute tab" : "Mute tab");mute.title = mute.textContent;mute.setAttribute("aria-label", mute.textContent);group.disabled = busy;
    } catch (error) { if (request === generation) message.textContent = t(String(error?.message ?? error)); }
  }
  row.append(label, smaller, reset, larger);group.append(row, mute, message);group.disabled = true;
  return { element: group, refresh };
}
