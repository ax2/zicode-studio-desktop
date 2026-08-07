import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { t } from "../../shared/i18n";
import { SceneIndicatorApp } from "./SceneIndicatorApp";
import {
  normalizeSceneId,
  resolveActiveProfile,
  toWelcomeScene,
  type WelcomeScene,
} from "./sceneIndicatorLogic";
import {
  fallbackSceneProfiles,
  type SceneProfile,
} from "../settings/sceneProfiles";

type TauriGlobal = {
  __TAURI__?: {
    core?: {
      invoke?: (..._args: unknown[]) => Promise<unknown>;
    };
  };
};

function defaultInvoke() {
  return (
    (globalThis as unknown as TauriGlobal).__TAURI__?.core?.invoke ?? null
  );
}

export interface SceneIndicatorControl {
  load(): Promise<void>;
  render(): void;
  setTarget(nextTarget: { sceneId?: string } | null | undefined): void;
}

export function setupSceneIndicator({
  getTarget = () => null,
  openSettings = () => {},
  invoke = defaultInvoke(),
  onWelcomeScene = null,
}: {
  getTarget?: () => { sceneId?: string } | null | undefined;
  openSettings?: () => void;
  invoke?: ((..._args: unknown[]) => Promise<unknown>) | null;
  onWelcomeScene?: ((scene: WelcomeScene) => void) | null;
} = {}): SceneIndicatorControl | null {
  const indicator = document.getElementById("scene-indicator");
  if (!indicator) return null;

  const indicatorEl = indicator;

  let profiles: SceneProfile[] = fallbackSceneProfiles;
  let activeSceneId = normalizeSceneId(getTarget()?.sceneId);

  const root: Root = createRoot(indicatorEl);

  function showSceneSettings() {
    openSettings();
    requestAnimationFrame(() => {
      document
        .getElementById("scene-profile-section")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  function renderWelcomeScene(profile: SceneProfile) {
    if (onWelcomeScene) {
      onWelcomeScene(toWelcomeScene(profile));
      return;
    }
    // Legacy fallback for the pre-React contract where setup mutates
    // .welcome-scene cards directly (preserved vanilla tests).
    for (const card of document.querySelectorAll(".welcome-scene")) {
      card.setAttribute("data-scene", profile.id);
      const name = card.querySelector("[data-scene-name]");
      if (name) name.textContent = t(profile.name);
      const description = card.querySelector("[data-scene-description]");
      if (description) {
        description.textContent = t(profile.description || "");
      }
      (card as HTMLElement).title = t("Open scene settings");
      (card as HTMLElement).onclick = showSceneSettings;
    }
  }

  function render() {
    const profile = resolveActiveProfile(profiles, activeSceneId);
    const name = t(profile.name);
    flushSync(() => {
      root.render(
        createElement(SceneIndicatorApp, {
          profile,
        }),
      );
    });
    indicatorEl.setAttribute("data-scene", profile.id);
    indicatorEl.title = `${t("Current scene")}: ${name}. ${t(
      "Click to configure new sessions.",
    )}`;
    renderWelcomeScene(profile);
  }

  async function load() {
    if (invoke) {
      try {
        const loadedProfiles = await invoke("list_scene_profiles");
        if (Array.isArray(loadedProfiles) && loadedProfiles.length) {
          profiles = loadedProfiles as SceneProfile[];
        }
      } catch {
        profiles = fallbackSceneProfiles;
      }
    }
    render();
  }

  function setTarget(nextTarget: { sceneId?: string } | null | undefined) {
    activeSceneId = normalizeSceneId(nextTarget?.sceneId);
    render();
  }

  indicatorEl.addEventListener("click", showSceneSettings);
  window.addEventListener("zicode:locale-changed", render);
  render();
  void load();

  return { load, render, setTarget };
}
