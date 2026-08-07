import { create } from "zustand";
import {
  fallbackSceneProfiles,
  getSelectedSceneId,
  normalizeSceneId,
  persistSelectedScene,
  type SceneProfile,
} from "./sceneProfiles";

const STORAGE_PREFIX = "picot-settings-";
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];

export interface SettingsWidgetsOptions {
  runtime?: {
    request(
      operation: { type: string; level: string },
      target: unknown,
      options?: { idempotencyKey?: string },
    ): Promise<unknown>;
  };
  getTarget?: () => { sceneId?: string } | null;
  invoke?: (command: string, params?: Record<string, unknown>) => Promise<unknown>;
  onError?: (error: unknown) => void;
  randomId?: () => string;
  confirmImpl?: (message: string) => boolean;
}

interface SceneEditorForm {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  allowedTools: string;
}

interface SettingsWidgetsState {
  toggles: Record<string, boolean>;
  thinkingLevel: string;
  sceneProfiles: SceneProfile[];
  sceneSelectedId: string;
  sceneCurrentId: string;
  sceneEditorOpen: boolean;
  sceneForm: SceneEditorForm;
  sceneStatus: { message: string; tone: "ok" | "error" } | null;
  sceneSaving: boolean;
  toggle(key: string): void;
  updateThinkingUI(level: string): void;
  setThinkingLevel(level: string): Promise<void>;
  loadSceneProfiles(): Promise<void>;
  setSceneSelected(id: string): void;
  setTarget(target: { sceneId?: string } | null): void;
  openSceneEditor(): void;
  closeSceneEditor(): void;
  setSceneForm(patch: Partial<SceneEditorForm>): void;
  saveSceneProfile(): Promise<void>;
  deleteSceneProfile(): Promise<void>;
}

function readToggle(key: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    return stored !== null ? stored === "true" : defaultValue;
  } catch {
    return defaultValue;
  }
}

export function createSettingsWidgetsStore(options: SettingsWidgetsOptions = {}) {
  const invoke = options.invoke;
  const getTarget = options.getTarget ?? (() => null);
  const onError = options.onError ?? (() => {});
  const randomId = options.randomId ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const confirmImpl = options.confirmImpl ?? ((message: string) => globalThis.confirm(message));

  function applyToggleEffect(key: string, enabled: boolean): void {
    if (key === "auto-compact") document.body.dataset.autoCompact = enabled ? "on" : "off";
    if (key === "show-thinking") document.body.dataset.showThinking = enabled ? "on" : "off";
    if (key === "auth") document.body.dataset.authEnabled = enabled ? "on" : "off";
    if (key === "beta-updates") {
      window.dispatchEvent(
        new CustomEvent("picot-update-channel-changed", { detail: { beta: enabled } }),
      );
    }
  }

  const initialToggles: Record<string, boolean> = {
    "auto-compact": readToggle("auto-compact", false),
    "show-thinking": readToggle("show-thinking", true),
    auth: readToggle("auth", false),
    "beta-updates": readToggle("beta-updates", false),
  };
  for (const [key, enabled] of Object.entries(initialToggles)) applyToggleEffect(key, enabled);

  const emptyForm: SceneEditorForm = {
    id: "",
    name: "",
    description: "",
    systemPrompt: "",
    allowedTools: "",
  };

  return create<SettingsWidgetsState>()((set, get) => ({
    toggles: initialToggles,
    thinkingLevel: "off",
    sceneProfiles: fallbackSceneProfiles,
    sceneSelectedId: getSelectedSceneId(),
    sceneCurrentId: normalizeSceneId(getTarget()?.sceneId),
    sceneEditorOpen: false,
    sceneForm: emptyForm,
    sceneStatus: null,
    sceneSaving: false,

    toggle(key) {
      const enabled = !get().toggles[key];
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(enabled));
      } catch {
        // Persistence is best-effort.
      }
      applyToggleEffect(key, enabled);
      set({ toggles: { ...get().toggles, [key]: enabled } });
    },

    updateThinkingUI(level) {
      if (THINKING_LEVELS.includes(level)) set({ thinkingLevel: level });
    },

    async setThinkingLevel(level) {
      const target = getTarget();
      if (!target) {
        onError(new Error("No active session"));
        return;
      }
      try {
        await options.runtime?.request(
          { type: "set_thinking_level", level },
          target,
          { idempotencyKey: randomId() },
        );
        get().updateThinkingUI(level);
      } catch (error) {
        onError(error);
      }
    },

    async loadSceneProfiles() {
      let profiles = fallbackSceneProfiles;
      if (invoke) {
        try {
          const loaded = (await invoke("list_scene_profiles")) as SceneProfile[];
          if (Array.isArray(loaded)) profiles = loaded;
        } catch {
          profiles = fallbackSceneProfiles;
        }
      }
      const selected = profiles.some((profile) => profile.id === get().sceneSelectedId)
        ? get().sceneSelectedId
        : "programming";
      set({ sceneProfiles: profiles, sceneSelectedId: selected });
    },

    setSceneSelected(id) {
      const profile = get().sceneProfiles.find((entry) => entry.id === id);
      persistSelectedScene(profile?.id || id);
      set({ sceneSelectedId: profile?.id || id });
    },

    setTarget(target) {
      set({ sceneCurrentId: normalizeSceneId(target?.sceneId) });
    },

    openSceneEditor() {
      set({ sceneEditorOpen: true, sceneForm: emptyForm, sceneStatus: null });
    },

    closeSceneEditor() {
      set({ sceneEditorOpen: false, sceneForm: emptyForm, sceneStatus: null });
    },

    setSceneForm(patch) {
      set({ sceneForm: { ...get().sceneForm, ...patch } });
    },

    async saveSceneProfile() {
      if (!invoke) {
        set({
          sceneStatus: {
            message: "Custom scenes can only be edited in the desktop app.",
            tone: "error",
          },
        });
        return;
      }
      const tools = get()
        .sceneForm.allowedTools.split(",")
        .map((tool) => tool.trim())
        .filter(Boolean);
      set({ sceneSaving: true, sceneStatus: null });
      try {
        const profile = (await invoke("save_scene_profile", {
          profile: {
            id: get().sceneForm.id.trim(),
            name: get().sceneForm.name.trim(),
            description: get().sceneForm.description.trim(),
            systemPrompt: get().sceneForm.systemPrompt.trim(),
            allowedTools: tools.length ? tools : null,
            builtin: false,
          },
        })) as SceneProfile;
        persistSelectedScene(profile.id);
        set({ sceneEditorOpen: false, sceneForm: emptyForm });
        await get().loadSceneProfiles();
      } catch (error) {
        set({
          sceneStatus: {
            message: error instanceof Error ? error.message : String(error),
            tone: "error",
          },
        });
      } finally {
        set({ sceneSaving: false });
      }
    },

    async deleteSceneProfile() {
      const profile = get().sceneProfiles.find((entry) => entry.id === get().sceneSelectedId);
      if (!invoke || !profile || profile.builtin !== false) return;
      if (
        !confirmImpl(
          `Delete custom scene "${profile.name}"? Its isolated data will be preserved.`,
        )
      ) {
        return;
      }
      try {
        await invoke("delete_scene_profile", { sceneId: profile.id });
        persistSelectedScene("programming");
        await get().loadSceneProfiles();
      } catch (error) {
        set({
          sceneStatus: {
            message: error instanceof Error ? error.message : String(error),
            tone: "error",
          },
        });
      }
    },
  }));
}

export type SettingsWidgetsStore = ReturnType<typeof createSettingsWidgetsStore>;
