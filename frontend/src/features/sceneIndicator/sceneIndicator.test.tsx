import { afterEach, describe, expect, it, vi } from "vitest";
import { setupSceneIndicator } from "./index";

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

describe("scene indicator (React)", () => {
  it("renders the active scene and pushes it to the welcome feed", async () => {
    render();
    const invoke = vi.fn(async () => []);
    const onWelcomeScene = vi.fn();
    const indicator = setupSceneIndicator({
      getTarget: () => ({ sceneId: "finance" }),
      invoke,
      onWelcomeScene,
    });
    expect(indicator).not.toBeNull();

    await vi.waitFor(() => {
      expect(onWelcomeScene).toHaveBeenCalled();
    });
    expect(document.getElementById("scene-indicator-name")?.textContent).toBe("金融");
    expect(document.getElementById("scene-indicator")?.dataset.scene).toBe("finance");

    indicator?.setTarget({ sceneId: "creation" });
    expect(document.getElementById("scene-indicator-name")?.textContent).toBe("创作");
    expect(onWelcomeScene).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "creation", name: "Creation" }),
    );
  });

  it("opens scene settings from the indicator", () => {
    render();
    const openSettings = vi.fn();
    setupSceneIndicator({
      getTarget: () => ({ sceneId: "programming" }),
      invoke: null,
      openSettings,
    });
    document.getElementById("scene-indicator")?.click();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});
