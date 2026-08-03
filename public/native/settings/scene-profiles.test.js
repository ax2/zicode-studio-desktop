import { afterEach, describe, expect, it, vi } from "vitest";
import { getSelectedSceneId, setupSceneProfiles } from "./scene-profiles.js";

function render() {
  document.body.innerHTML = `
    <select id="scene-profile-select"></select>
    <span id="scene-profile-description"></span>
    <strong id="scene-profile-current-name"></strong>
    <code id="scene-profile-current-id"></code>
    <button id="scene-profile-new"></button>
    <button id="scene-profile-delete" class="hidden"></button>
    <form id="scene-profile-editor" class="hidden">
      <input id="scene-profile-id" />
      <input id="scene-profile-name" />
      <input id="scene-profile-description-input" />
      <textarea id="scene-profile-prompt"></textarea>
      <input id="scene-profile-tools" />
      <div id="scene-profile-status" class="hidden"></div>
      <button id="scene-profile-cancel" type="button"></button>
      <button id="scene-profile-save" type="submit"></button>
    </form>
  `;
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  // biome-ignore lint/suspicious/noDocumentCookie: test cleanup for cross-port preference
  document.cookie = "zicode-studio-scene=; Max-Age=0; Path=/";
  delete globalThis.__TAURI__;
});

describe("scene profile settings", () => {
  it("persists the selected built-in scene for new sessions", async () => {
    render();
    const profiles = setupSceneProfiles({
      getTarget: () => ({ sceneId: "programming" }),
    });
    const select = document.getElementById("scene-profile-select");

    select.value = "finance";
    select.dispatchEvent(new Event("change"));

    expect(getSelectedSceneId()).toBe("finance");
    expect(document.getElementById("scene-profile-description").textContent).toContain(
      "read-only",
    );
    expect(document.getElementById("scene-profile-current-id").textContent).toBe(
      "programming",
    );

    profiles.setTarget({ sceneId: "creation" });
    expect(document.getElementById("scene-profile-current-name").textContent).toBe("Creation");
    expect(select.value).toBe("finance");
  });

  it("saves a custom scene through the native host", async () => {
    render();
    const profiles = [
      {
        id: "programming",
        name: "Programming",
        description: "Code",
        builtin: true,
      },
    ];
    const invoke = vi.fn(async (command, args) => {
      if (command === "list_scene_profiles") return profiles;
      if (command === "save_scene_profile") {
        profiles.push(args.profile);
        return args.profile;
      }
    });
    globalThis.__TAURI__ = { core: { invoke } };
    setupSceneProfiles();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("list_scene_profiles"),
    );
    document.getElementById("scene-profile-new").click();
    document.getElementById("scene-profile-id").value = "research";
    document.getElementById("scene-profile-name").value = "Research";
    document.getElementById("scene-profile-tools").value = "read, grep";
    document
      .getElementById("scene-profile-editor")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "save_scene_profile",
        expect.objectContaining({
          profile: expect.objectContaining({
            id: "research",
            allowedTools: ["read", "grep"],
          }),
        }),
      ),
    );
    expect(getSelectedSceneId()).toBe("research");
  });
});
