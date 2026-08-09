import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { GeneralTab } from "./SettingsPanelApp";
import { createSettingsStore } from "./store";
import { createSettingsWidgetsStore } from "./settingsWidgetsStore";
import { fallbackSceneProfiles, getSelectedSceneId } from "./sceneProfiles";
import type { SettingsController } from "./SettingsPanelApp";

const controllerStub = {
  loadForTab: vi.fn(),
  wireVanilla: vi.fn(),
  reloadVisibleConfiguration: vi.fn(),
  setTarget: vi.fn(),
} as unknown as SettingsController;

function renderGeneral(widgets?: ReturnType<typeof createSettingsWidgetsStore>) {
  localStorage.clear();
  const store = createSettingsStore();
  const widgetsStore = widgets ?? createSettingsWidgetsStore();
  const view = render(
    <GeneralTab store={store} widgets={widgetsStore} controller={controllerStub} />,
  );
  return { store, widgets: widgetsStore, view };
}

describe("settings widgets store", () => {
  it("toggles persist to localStorage and apply body dataset effects", () => {
    const store = createSettingsWidgetsStore();
    act(() => store.getState().toggle("auto-compact"));
    expect(store.getState().toggles["auto-compact"]).toBe(true);
    expect(localStorage.getItem("picot-settings-auto-compact")).toBe("true");
    expect(document.body.dataset.autoCompact).toBe("on");
    expect(document.body.dataset.showThinking).toBe("on");
  });

  it("dispatches the beta channel event when beta updates toggle", () => {
    const dispatched = vi.fn();
    window.addEventListener("picot-update-channel-changed", dispatched);
    const store = createSettingsWidgetsStore();
    act(() => store.getState().toggle("beta-updates"));
    expect(dispatched).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { beta: true } }),
    );
    window.removeEventListener("picot-update-channel-changed", dispatched);
  });

  it("sets the thinking level through the runtime and syncs the UI", async () => {
    const request = vi.fn(async () => ({}));
    const store = createSettingsWidgetsStore({
      runtime: { request },
      getTarget: () => ({ sceneId: "programming" }),
      randomId: () => "id-1",
    });
    await store.getState().setThinkingLevel("high");
    expect(request).toHaveBeenCalledWith(
      { type: "set_thinking_level", level: "high" },
      { sceneId: "programming" },
      { idempotencyKey: "id-1" },
    );
    expect(store.getState().thinkingLevel).toBe("high");
    store.getState().updateThinkingUI("low");
    expect(store.getState().thinkingLevel).toBe("low");
  });

  it("sends the auto-compaction preference to the session runtime", async () => {
    const request = vi.fn(async () => ({}));
    const store = createSettingsWidgetsStore({
      runtime: { request },
      getTarget: () => ({ sceneId: "programming" }),
      randomId: () => "id-auto",
    });
    await store.getState().setAutoCompaction(true);
    expect(request).toHaveBeenCalledWith(
      { type: "set_auto_compaction", enabled: true },
      { sceneId: "programming" },
      { idempotencyKey: "id-auto" },
    );
  });

  it("wires the auto-compaction toggle to the runtime send", async () => {
    localStorage.clear();
    const request = vi.fn(async () => ({}));
    const store = createSettingsWidgetsStore({
      runtime: { request },
      getTarget: () => ({ sceneId: "programming" }),
    });
    act(() => store.getState().toggle("auto-compact"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ type: "set_auto_compaction", enabled: true }),
      { sceneId: "programming" },
      expect.anything(),
    );
  });

  it("loads scene profiles and selects the persisted scene", async () => {
    const store = createSettingsWidgetsStore({
      invoke: vi.fn(async () => [
        ...fallbackSceneProfiles,
        { id: "research", name: "Research", builtin: false },
      ]),
    });
    await store.getState().loadSceneProfiles();
    expect(store.getState().sceneProfiles).toHaveLength(4);
    store.getState().setSceneSelected("research");
    expect(store.getState().sceneSelectedId).toBe("research");
    expect(getSelectedSceneId()).toBe("research");
  });

  it("saves a custom scene profile through invoke", async () => {
    const save = vi.fn(async () => ({ id: "research", name: "Research" }));
    const store = createSettingsWidgetsStore({
      invoke: save,
      getTarget: () => ({ sceneId: "programming" }),
    });
    store.getState().openSceneEditor();
    store.getState().setSceneForm({
      id: "research",
      name: "Research",
      description: "Research workflows",
      allowedTools: "read, grep",
    });
    await store.getState().saveSceneProfile();
    expect(save).toHaveBeenCalledWith(
      "save_scene_profile",
      expect.objectContaining({
        profile: expect.objectContaining({ id: "research", allowedTools: ["read", "grep"] }),
      }),
    );
    expect(store.getState().sceneEditorOpen).toBe(false);
  });

  it("awaits an async confirmation before deleting a custom scene", async () => {
    const deleteProfile = vi.fn(async (_command: string, _params: unknown) => ({}));
    const makeInvoke = () =>
      vi.fn(async (command: string, params: unknown) => {
        if (command === "list_scene_profiles") {
          return [
            ...fallbackSceneProfiles,
            { id: "research", name: "Research", builtin: false },
          ];
        }
        if (command === "delete_scene_profile") {
          deleteProfile(command, params);
          return {};
        }
        return null;
      });

    const declining = createSettingsWidgetsStore({
      invoke: makeInvoke(),
      getTarget: () => ({ sceneId: "programming" }),
      confirmImpl: async () => false,
    });
    await declining.getState().loadSceneProfiles();
    declining.getState().setSceneSelected("research");
    await declining.getState().deleteSceneProfile();
    expect(deleteProfile).not.toHaveBeenCalled();

    const accepting = createSettingsWidgetsStore({
      invoke: makeInvoke(),
      getTarget: () => ({ sceneId: "programming" }),
      confirmImpl: async () => true,
    });
    await accepting.getState().loadSceneProfiles();
    accepting.getState().setSceneSelected("research");
    await accepting.getState().deleteSceneProfile();
    expect(deleteProfile).toHaveBeenCalledWith("delete_scene_profile", {
      sceneId: "research",
    });
  });
});

describe("settings widgets React render", () => {
  it("renders toggles, thinking effort, and scene profiles in the general tab", async () => {
    const { widgets } = renderGeneral();
    expect(document.getElementById("toggle-auto-compact")).toBeTruthy();
    expect(document.getElementById("toggle-show-thinking")?.classList.contains("on")).toBe(true);
    expect(document.getElementById("toggle-auto-compact")?.getAttribute("aria-label")).toBeTruthy();
    expect(document.getElementById("toggle-show-thinking")?.getAttribute("aria-label")).toBeTruthy();
    expect(document.querySelectorAll(".thinking-effort-dot").length).toBe(5);
    expect(document.getElementById("scene-profile-select")).toBeTruthy();
    expect(document.getElementById("scene-profile-select")?.getAttribute("aria-label")).toBeTruthy();
    await waitFor(() =>
      expect(
        (document.getElementById("scene-profile-select") as HTMLSelectElement | null)?.options
          .length,
      ).toBeGreaterThan(0),
    );
    act(() => widgets.getState().toggle("auto-compact"));
    expect(
      document.getElementById("toggle-auto-compact")?.classList.contains("on"),
    ).toBe(true);
  });

  it("opens the scene editor form and updates fields", async () => {
    const { widgets } = renderGeneral();
    await waitFor(() =>
      expect(
        (document.getElementById("scene-profile-select") as HTMLSelectElement | null)?.options
          .length,
      ).toBeGreaterThan(0),
    );
    act(() => widgets.getState().openSceneEditor());
    expect(document.getElementById("scene-profile-editor")).toBeTruthy();
    act(() => widgets.getState().setSceneForm({ name: "Research" }));
    expect((document.getElementById("scene-profile-name") as HTMLInputElement).value).toBe(
      "Research",
    );
    expect(document.getElementById("scene-profile-save")).toBeTruthy();
  });
});
