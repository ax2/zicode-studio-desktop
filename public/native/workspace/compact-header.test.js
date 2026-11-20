import { afterEach, expect, it } from "vitest";
import { setupCompactHeader } from "./compact-header.js";

let stop;
afterEach(() => { stop?.(); document.body.replaceChildren(); delete document.body.dataset.activePlugin; });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
it("shows only the current page controls, including late mounts and removals", async () => {
  document.body.innerHTML = '<div id="page-header-actions"><div data-page-header-owner="browser"></div><div data-page-header-owner="notes"></div></div>';
  document.body.dataset.activePlugin = "browser"; stop = setupCompactHeader();
  const slot = document.querySelector('#page-header-actions');
  expect(slot.children[0].hidden).toBe(false); expect(slot.children[1].hidden).toBe(true);
  document.body.dataset.activePlugin = "notes"; await settle();
  expect(slot.children[0].hidden).toBe(true); expect(slot.children[1].hidden).toBe(false);
  slot.children[1].remove(); await settle(); expect(slot.hidden).toBe(true);
});
it("keeps a named connection status while changing its icon", async () => {
  document.body.innerHTML = '<div class="status"><span id="status-indicator" class="disconnected"></span><span id="status-text">Disconnected</span></div>';
  stop = setupCompactHeader(); const icon = document.querySelector('#status-indicator');
  expect(icon.dataset.icon).toBe('disconnected'); expect(icon.parentElement.getAttribute('aria-label')).toBeTruthy();
  icon.className = 'connected'; document.querySelector('#status-text').textContent = 'Connected'; await settle();
  expect(icon.dataset.icon).toBe('connected'); expect(icon.querySelector('svg')).toBeTruthy();
});
