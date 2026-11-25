import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupSidebarToggle } from "./sidebar-toggle.js";

function render(width = 390) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  document.body.innerHTML = `
    <aside id="sidebar" tabindex="-1">
      <input id="session-search-input" type="search" />
      <button class="plugin-sidebar-view-header">Disclosure</button>
      <button class="content-action">Open item</button>
      <button class="session-more-btn">More</button>
      <button class="session-archive-btn">Archive</button>
      <button class="project-more-btn">Project more</button>
      <button id="workspace-switcher-btn">Switch</button>
      <div id="workspace-switcher-menu"><button class="workspace-switcher-item">WS</button></div>
    </aside>
    <div id="sidebar-overlay" aria-hidden="true"></div>
    <main class="main">
      <button id="sidebar-toggle" aria-expanded="true"></button>
      <button id="obscured-action">Main action</button>
    </main>
    <button id="bottom-navigation">Bottom navigation</button>
  `;
  return setupSidebarToggle();
}

describe("mobile function area", () => {
  let controller;

  function resize(width) {
    window.innerWidth = width;
    window.dispatchEvent(new Event("resize"));
  }

  afterEach(() => {
    controller?.destroy();
    vi.restoreAllMocks();
  });

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

  it("suspends the covered main view and releases it without moving focus from bottom navigation", () => {
    controller = render();
    const main = document.querySelector(".main");
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebar-toggle");
    const bottom = document.getElementById("bottom-navigation");
    toggle.focus();
    toggle.click();
    expect(main.hasAttribute("inert")).toBe(true);
    expect(bottom.closest("[inert]")).toBeNull();
    expect(document.activeElement).toBe(sidebar);
    bottom.focus();
    bottom.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(main.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(bottom);
  });

  it("does not suspend the main view when the backdrop is hidden by the layout", () => {
    controller = render();
    const main = document.querySelector(".main");
    const toggle = document.getElementById("sidebar-toggle");
    document.getElementById("sidebar-overlay").style.display = "none";
    toggle.focus();
    toggle.click();
    expect(main.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it("leaves Escape to an open top-level dialog before dismissing the drawer", () => {
    controller = render();
    const toggle = document.getElementById("sidebar-toggle");
    toggle.click();
    const dialog = document.createElement("dialog");
    dialog.open = true;
    document.querySelector(".main").append(dialog);
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
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

  it.each([
    ["composing", { isComposing: true }],
    ["IME tail", { keyCode: 229 }],
  ])("leaves Escape to session search while %s", (_phase, flags) => {
    controller = render();
    const drawer = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebar-toggle");
    const overlay = document.getElementById("sidebar-overlay");
    const search = document.getElementById("session-search-input");
    toggle.click();
    search.focus();
    search.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", bubbles: true, cancelable: true, ...flags,
    }));
    expect(drawer.classList.contains("collapsed")).toBe(false);
    expect(overlay.classList.contains("visible")).toBe(true);
    expect(document.activeElement).toBe(search);

    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(drawer.classList.contains("collapsed")).toBe(true);
    expect(overlay.classList.contains("visible")).toBe(false);
    expect(document.activeElement).toBe(toggle);
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

  it("keeps the selected settings category when closing a narrow drawer", async () => {
    history.replaceState(null, "", "/app/#/settings");
    controller = render();
    document.getElementById("sidebar-toggle").click();
    const tab = document.querySelector(".content-action");
    tab.addEventListener("click", () => history.replaceState(history.state, "", "#/settings/updates"));
    tab.click();
    await Promise.resolve();
    expect(document.getElementById("sidebar").classList.contains("collapsed")).toBe(true);
    expect(location.hash).toBe("#/settings/updates");
    expect(history.state?.zicodeMobileLayer).toBeUndefined();
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

  it("consumes the same-route drawer entry once when the window widens", () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    controller = render();
    document.getElementById("sidebar-toggle").click();
    resize(1180);
    resize(1180);
    expect(back).toHaveBeenCalledOnce();
    expect(document.getElementById("sidebar-overlay").getAttribute("aria-hidden")).toBe("true");
  });

  it("leaves a nested layer in control and never backs out of a replaced destination", () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    controller = render();
    const toggle = document.getElementById("sidebar-toggle");
    toggle.click();
    history.pushState({ zicodeMobileLayer: "nested-dialog" }, "", location.href);
    resize(1180);
    expect(back).not.toHaveBeenCalled();
    expect(history.state.zicodeMobileLayer).toBe("nested-dialog");

    history.replaceState(null, "", "/app/chat");
    resize(420);
    toggle.click();
    history.replaceState({ ...history.state, route: "settings" }, "", "/app/#/settings/updates");
    resize(1180);
    expect(back).not.toHaveBeenCalled();
    expect(location.hash).toBe("#/settings/updates");
    expect(history.state).toEqual({ route: "settings" });
  });

  it("keeps a drawer reopened during a pending Back after rapid resizes", () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    controller = render();
    const toggle = document.getElementById("sidebar-toggle");
    toggle.click();
    resize(1180);
    resize(420);
    toggle.click();
    expect(back).toHaveBeenCalledOnce();
    history.replaceState(null, "", location.href);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(history.state.zicodeMobileLayer).toBe("function-area");
  });

  it("does not repeat the Back triggered by actively closing the drawer", () => {
    const back = vi.spyOn(history, "back").mockImplementation(() => {});
    controller = render();
    const toggle = document.getElementById("sidebar-toggle");
    toggle.click();
    toggle.click();
    resize(1180);
    expect(back).toHaveBeenCalledOnce();
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

