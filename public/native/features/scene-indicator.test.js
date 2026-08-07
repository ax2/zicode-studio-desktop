import { afterEach, describe, expect, it, vi } from "vitest";
import { setupSceneIndicator } from "../react/scene-indicator.js";

function render() {
  document.body.innerHTML = `
    <button id="scene-indicator" data-scene="programming">
      <strong id="scene-indicator-name"></strong>
    </button>
    <button class="welcome-scene">
      <span data-scene-name></span>
      <span data-scene-description></span>
    </button>
    <section id="scene-profile-section"></section>
  `;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("active scene indicator", () => {
  it("shows the scene attached to the current runtime target", async () => {
    render();
    const invoke = vi.fn(async () => [
      {
        id: "finance",
        name: "Finance",
        description: "Evidence-led financial analysis.",
        builtin: true,
      },
      {
        id: "creation",
        name: "Creation",
        description: "Structured content production.",
        builtin: true,
      },
    ]);
    const indicator = setupSceneIndicator({
      getTarget: () => ({ sceneId: "finance" }),
      invoke,
    });

    await vi.waitFor(() =>
      expect(document.getElementById("scene-indicator-name").textContent).toBe("金融"),
    );
    expect(document.getElementById("scene-indicator").dataset.scene).toBe("finance");
    expect(document.querySelector("[data-scene-description]").textContent).toContain("Evidence");

    indicator.setTarget({ sceneId: "creation" });
    expect(document.getElementById("scene-indicator-name").textContent).toBe("创作");
  });

  it("opens the scene settings from both visible entry points", () => {
    render();
    const openSettings = vi.fn();
    setupSceneIndicator({
      getTarget: () => ({ sceneId: "programming" }),
      invoke: null,
      openSettings,
    });

    document.getElementById("scene-indicator").click();
    document.querySelector(".welcome-scene").click();
    expect(openSettings).toHaveBeenCalledTimes(2);
  });
});
