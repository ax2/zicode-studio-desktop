import { describe, expect, it } from "vitest";
import { mountPluginSurface } from "./reactMount.js";

describe("mountPluginSurface", () => {
  it("preserves shell chrome while replacing only the app mount", () => {
    const container = document.createElement("div");
    const chrome = document.createElement("div");
    chrome.className = "shell-chrome";
    chrome.textContent = "project row + title";
    container.append(chrome);

    const firstRoot = mountPluginSurface(container, <div data-app="one" />, null);
    expect(container.querySelector('[data-app="one"]')).toBeTruthy();
    expect(container.querySelector(".shell-chrome")).toBeTruthy();
    expect(container.querySelectorAll(".plugin-app-mount").length).toBe(1);

    mountPluginSurface(container, <div data-app="two" />, firstRoot);
    expect(container.querySelector('[data-app="two"]')).toBeTruthy();
    expect(container.querySelector('[data-app="one"]')).toBeNull();
    expect(container.querySelector(".shell-chrome")).toBeTruthy();
    expect(container.querySelectorAll(".plugin-app-mount").length).toBe(1);
  });
});
