import { t } from "../../i18n.js";
import { fallbackSceneProfiles } from "../settings/scene-profiles.js";

export function setupSceneIndicator({
  getTarget,
  openSettings,
  invoke = globalThis.__TAURI__?.core?.invoke,
} = {}) {
  const indicator = document.getElementById("scene-indicator");
  const indicatorName = document.getElementById("scene-indicator-name");
  if (!indicator || !indicatorName) return null;

  let profiles = fallbackSceneProfiles;
  let activeSceneId = normalizeSceneId(getTarget?.()?.sceneId);

  function activeProfile() {
    return (
      profiles.find((profile) => profile.id === activeSceneId) || {
        id: activeSceneId,
        name: activeSceneId,
        description: "Custom scene with isolated configuration and runtime data.",
      }
    );
  }

  function renderWelcomeScene(profile) {
    for (const card of document.querySelectorAll(".welcome-scene")) {
      card.dataset.scene = profile.id;
      card.querySelector("[data-scene-name]").textContent = t(profile.name);
      card.querySelector("[data-scene-description]").textContent = t(profile.description || "");
      card.title = t("Open scene settings");
      card.onclick = showSceneSettings;
    }
  }

  function render() {
    const profile = activeProfile();
    const name = t(profile.name);
    indicator.dataset.scene = profile.id;
    indicatorName.textContent = name;
    indicator.title = `${t("Current scene")}: ${name}. ${t("Click to configure new sessions.")}`;
    renderWelcomeScene(profile);
  }

  function showSceneSettings() {
    openSettings?.();
    requestAnimationFrame(() => {
      document
        .getElementById("scene-profile-section")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  async function load() {
    if (invoke) {
      try {
        const loadedProfiles = await invoke("list_scene_profiles");
        if (Array.isArray(loadedProfiles) && loadedProfiles.length) profiles = loadedProfiles;
      } catch {
        profiles = fallbackSceneProfiles;
      }
    }
    render();
  }

  function setTarget(nextTarget) {
    activeSceneId = normalizeSceneId(nextTarget?.sceneId);
    render();
  }

  indicator.addEventListener("click", showSceneSettings);
  window.addEventListener("zicode:locale-changed", render);
  render();
  void load();

  return { load, render, setTarget };
}

function normalizeSceneId(sceneId) {
  return typeof sceneId === "string" && sceneId.trim() ? sceneId : "programming";
}
