import { describe, expect, it, vi } from "vitest";
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

  it("shows a retryable fallback when a plugin view throws during render", () => {
    const container = document.createElement("div");
    const Boom = () => {
      throw new Error("boom");
    };

    // Suppress the expected console.error from the boundary.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = mountPluginSurface(container, <Boom />, null);

    expect(container.querySelector(".plugin-crash-fallback")).toBeTruthy();
    expect(container.textContent).toContain("此视图遇到了意外错误。");

    // Retry re-renders the children; a component that stops throwing recovers.
    const StopBoom = ({ crashed }: { crashed: boolean }) => {
      if (crashed) throw new Error("boom again");
      return <div data-app="recovered" />;
    };
    mountPluginSurface(container, <StopBoom crashed={false} />, root);
    expect(container.querySelector('[data-app="recovered"]')).toBeTruthy();
    errorSpy.mockRestore();
  });
});
