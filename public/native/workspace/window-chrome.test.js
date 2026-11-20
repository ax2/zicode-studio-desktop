import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupWindowChrome } from "./window-chrome.js";
let view;
afterEach(() => { view?.dispose(); view = null; document.body.replaceChildren(); });
function setup(invoke = vi.fn(async () => ({ maximized: false, fullscreen: false }))) {
  document.body.innerHTML = '<div class="app-layout"><div class="session-header"><button class="existing">Existing tool</button></div></div>';
  const report = vi.fn(); view = setupWindowChrome({ invoke, report }); return { invoke, report };
}
it("shares controls outside the changing page content and calls only the owning window command", async () => {
  const h = setup(); const close = document.querySelector('[data-window-action="close"]');
  expect(document.querySelectorAll('.window-control')).toHaveLength(3); expect(close.getAttribute('aria-label')).toBeTruthy();
  expect(close.closest('.window-controls').parentElement).toBe(document.querySelector('.app-layout'));
  expect(document.querySelector('.session-header .window-controls-slot').childElementCount).toBe(0);
  close.click(); await waitFor(() => expect(h.invoke).toHaveBeenCalledWith('desktop_window_control', { action: 'close' }));
  document.body.dataset.activePlugin = 'com.zicode.notes'; expect(close.isConnected).toBe(true);
});
it("keeps drag gestures out of tool buttons and tab content", () => {
  const h = setup(); h.invoke.mockClear();
  document.querySelector('.existing').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 }));
  expect(h.invoke).not.toHaveBeenCalled();
  document.querySelector('.window-drag-handle').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 }));
  expect(h.invoke).toHaveBeenCalledWith('desktop_window_control', { action: 'drag' });
});
it("coalesces repeated clicks while a native maximize is pending and reports errors", async () => {
  let finish; const h = setup(vi.fn(action => action === 'unused' ? undefined : Promise.resolve({ maximized: false, fullscreen: false })));
  await view.refresh(); h.invoke.mockImplementation((_command, { action }) => action === 'toggleMaximize' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ maximized: true, fullscreen: false }));
  const max = document.querySelector('[data-window-action="toggleMaximize"]'); max.click(); max.click(); finish({});
  await waitFor(() => expect(max.innerHTML).toContain('M9 5'));
  expect(h.invoke.mock.calls.filter(([, arg]) => arg.action === 'toggleMaximize')).toHaveLength(1);
  h.invoke.mockRejectedValueOnce(Error('Native failure')); max.click(); await waitFor(() => expect(h.report).toHaveBeenCalledOnce());
});
it("does not add desktop window actions to ordinary web clients", () => {
  document.body.innerHTML = '<div class="app-layout"><div class="session-header"></div></div>'; setupWindowChrome({ invoke: null }); expect(document.querySelector('.window-controls')).toBeNull();
});
