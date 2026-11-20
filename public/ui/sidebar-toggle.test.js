import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupSidebarToggle } from "./sidebar-toggle.js";

function render(width = 390) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  document.body.innerHTML = `
    <aside id="sidebar">
      <button class="plugin-sidebar-view-header">Disclosure</button>
      <button class="content-action">Open item</button>
      <button class="session-more-btn">More</button>
      <button class="session-archive-btn">Archive</button>
      <button class="project-more-btn">Project more</button>
      <button id="workspace-switcher-btn">Switch</button>
      <div id="workspace-switcher-menu"><button class="workspace-switcher-item">WS</button></div>
    </aside>
    <div id="sidebar-overlay" aria-hidden="true"></div>
    <button id="sidebar-toggle" aria-expanded="true"></button>
  `;
  return setupSidebarToggle();
}

describe("mobile function area", () => {
  let controller;

  afterEach(() => controller?.destroy());

  beforeEach(() => {
    controller = null;
    history.replaceState(null, "", "/app/chat");
  });

  it("starts closed on phones and exposes synchronized accessibility state", () => {
    controller = render();
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
    expect(document.getElementById("sidebar-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("sidebar-overlay").getAttribute("aria-hidden")).toBe("true");
  });

  it("opens from application navigation and closes after choosing content", async () => {
    controller = render();
    document.dispatchEvent(
      new CustomEvent("zicode:function-area-request", { detail: { open: true } }),
    );
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);
    expect(document.getElementById("sidebar-overlay").classList.contains("visible")).toBe(true);

    document.querySelector(".content-action").click();
    await Promise.resolve();
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
  });

  it("keeps disclosure controls open and closes with Escape", () => {
    controller = render();
    document.getElementById("sidebar-toggle").click();
    document.querySelector(".plugin-sidebar-view-header").click();
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
    expect(document.activeElement).toBe(document.getElementById("sidebar-toggle"));
  });

  it("keeps the drawer open for session menus and the workspace switcher", () => {
    controller = render();
    document.getElementById("sidebar-toggle").click();
    for (const selector of [
      ".session-more-btn",
      ".session-archive-btn",
      ".project-more-btn",
      "#workspace-switcher-btn",
      ".workspace-switcher-item",
    ]) {
      document.querySelector(selector).click();
      expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);
    }
  });

  it("lets the mobile Back gesture close the open function area before leaving the app", () => {
    controller = render();
    document.getElementById("sidebar-toggle").click();
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);
    expect(history.state?.zicodeMobileLayer).toBe("function-area");

    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
  });

  it("leaves the drawer open when a nested overlay already handled Escape", () => {
    controller = render();
    document.getElementById("sidebar-toggle").click();
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    event.preventDefault();
    document.dispatchEvent(event);
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);
  });

  it("collapses when a desktop window crosses into the mobile breakpoint", () => {
    controller = render(1024);
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);
    window.innerWidth = 390;
    window.dispatchEvent(new Event("resize"));
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
  });

  it("restores the desktop function area after leaving the mobile breakpoint", () => {
    controller = render();
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
    window.innerWidth = 1024;
    window.dispatchEvent(new Event("resize"));
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);
    expect(document.getElementById("sidebar-toggle").getAttribute("aria-expanded")).toBe("true");
  });

  it("treats a short coarse-pointer landscape viewport as mobile", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    });
    controller = render(844);
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
    controller.destroy();
    controller = null;
    window.matchMedia = originalMatchMedia;
  });
});

it("does not create a drawer backdrop for a page whose sidebar is hidden", () => {
  const controller = render();
  try {
    document.getElementById("sidebar").style.display = "none";
    document.dispatchEvent(new CustomEvent("zicode:active-plugin-changed", { detail: { pluginId: "core.tools" } }));
    document.dispatchEvent(new CustomEvent("zicode:function-area-request", { detail: { open: true } }));
    expect(document.getElementById("sidebar-overlay").classList.contains("visible")).toBe(false);
    expect(document.getElementById("sidebar-overlay").getAttribute("aria-hidden")).toBe("true");
    expect(document.getElementById("sidebar-toggle").hidden).toBe(true);
    expect(document.getElementById("sidebar-toggle").disabled).toBe(true);
    document.getElementById("sidebar-toggle").click();
    expect(document.getElementById("sidebar-overlay").classList.contains("visible")).toBe(false);
  } finally { controller.destroy(); }
});

it("closes an existing drawer without navigating Back when its destination has no sidebar", () => {
  const controller = render();
  try {
    document.getElementById("sidebar-toggle").click();
    expect(history.state?.zicodeMobileLayer).toBe("function-area");
    document.getElementById("sidebar").style.display = "none";
    document.dispatchEvent(new CustomEvent("zicode:active-plugin-changed"));
    expect(document.getElementById("sidebar-overlay").classList.contains("visible")).toBe(false);
    expect(history.state?.zicodeMobileLayer).toBeUndefined();
    document.getElementById("sidebar").style.display = "";
    document.dispatchEvent(new CustomEvent("zicode:active-plugin-changed"));
    expect(document.getElementById("sidebar-toggle").hidden).toBe(false);
    expect(document.getElementById("sidebar-toggle").disabled).toBe(false);
    document.getElementById("sidebar-toggle").click();
    expect(document.getElementById("sidebar-overlay").classList.contains("visible")).toBe(true);
  } finally { controller.destroy(); }
});

it("keeps the desktop sidebar preference when visiting a page without a sidebar", () => {
  const controller = render(1024);
  try {
    document.getElementById("sidebar").style.display = "none";
    document.dispatchEvent(new CustomEvent("zicode:active-plugin-changed"));
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);
    document.getElementById("sidebar").style.display = "";
    document.dispatchEvent(new CustomEvent("zicode:active-plugin-changed"));
    expect(document.getElementById("sidebar-toggle").hidden).toBe(false);
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(false);
  } finally { controller.destroy(); }
});

it("dismisses an open drawer when its sidebar becomes hidden without a navigation event", async () => {
  const controller = render();
  try {
    document.getElementById("sidebar-toggle").click();
    document.getElementById("sidebar").hidden = true;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById("sidebar-overlay").classList.contains("visible")).toBe(false);
    expect(document.getElementById("sidebar-overlay").getAttribute("aria-hidden")).toBe("true");
    expect(document.getElementById("sidebar-toggle").hidden).toBe(true);
    expect(history.state?.zicodeMobileLayer).toBeUndefined();
    document.getElementById("sidebar").hidden = false;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(document.getElementById("sidebar-toggle").hidden).toBe(false);
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
  } finally { controller.destroy(); }
});

it("synchronizes a drawer collapsed outside its toggle and ignores changes after disposal", async () => {
  const controller = render();
  document.getElementById("sidebar-toggle").click();
  document.getElementById("sidebar").classList.add("collapsed");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.getElementById("sidebar-overlay").classList.contains("visible")).toBe(false);
  expect(document.getElementById("sidebar-toggle").getAttribute("aria-expanded")).toBe("false");
  expect(history.state?.zicodeMobileLayer).toBeUndefined();
  controller.destroy();
  document.getElementById("sidebar").hidden = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.getElementById("sidebar-toggle").hidden).toBe(false);
});

