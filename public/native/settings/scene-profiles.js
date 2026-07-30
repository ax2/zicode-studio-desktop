import {
  clearSettingsSaveMessage,
  setSettingsSaveButtonSaving,
  showSettingsSaveError,
} from "./settings-save-status.js";

const STORAGE_KEY = "pi-desktop:selected-scene";
const COOKIE_KEY = "zicode-studio-scene";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;
const FALLBACK_SCENES = [
  {
    id: "programming",
    name: "Programming",
    description: "Code, debugging, repositories, and technical research.",
    builtin: true,
  },
  {
    id: "finance",
    name: "Finance",
    description: "Financial analysis with a read-only local tool policy.",
    builtin: true,
  },
  {
    id: "creation",
    name: "Creation",
    description: "Writing, ideation, visual direction, and content production.",
    builtin: true,
  },
];

export function getSelectedSceneId() {
  try {
    const entry = document.cookie
      .split("; ")
      .find((value) => value.startsWith(`${COOKIE_KEY}=`));
    if (entry) return decodeURIComponent(entry.slice(COOKIE_KEY.length + 1));
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      persistSelectedScene(legacy);
      return legacy;
    }
  } catch {
    // Sandboxed WebViews may reject cookie or localStorage access.
  }
  return "programming";
}

function persistSelectedScene(sceneId) {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: cross-port desktop preference storage
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(sceneId)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
    localStorage.setItem(STORAGE_KEY, sceneId);
  } catch {
    // Keep the in-memory select usable even when persistence is unavailable.
  }
}

export function setupSceneProfiles() {
  const select = document.getElementById("scene-profile-select");
  if (!select) return null;
  const description = document.getElementById("scene-profile-description");
  const editor = document.getElementById("scene-profile-editor");
  const newButton = document.getElementById("scene-profile-new");
  const deleteButton = document.getElementById("scene-profile-delete");
  const cancelButton = document.getElementById("scene-profile-cancel");
  const saveButton = document.getElementById("scene-profile-save");
  const status = document.getElementById("scene-profile-status");
  const idInput = document.getElementById("scene-profile-id");
  const nameInput = document.getElementById("scene-profile-name");
  const descriptionInput = document.getElementById("scene-profile-description-input");
  const promptInput = document.getElementById("scene-profile-prompt");
  const toolsInput = document.getElementById("scene-profile-tools");
  const invoke = globalThis.__TAURI__?.core?.invoke;
  let profiles = FALLBACK_SCENES;

  function selectedProfile() {
    return profiles.find((profile) => profile.id === select.value) || profiles[0];
  }

  function updateSelectionDetails() {
    const profile = selectedProfile();
    if (!profile) return;
    description.textContent = profile.description || "";
    deleteButton.classList.toggle("hidden", profile.builtin !== false);
    persistSelectedScene(profile.id);
  }

  function render() {
    const selected = getSelectedSceneId();
    select.replaceChildren();
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      select.append(option);
    }
    select.value = profiles.some((profile) => profile.id === selected) ? selected : "programming";
    updateSelectionDetails();
  }

  async function load() {
    if (invoke) {
      try {
        profiles = await invoke("list_scene_profiles");
      } catch {
        profiles = FALLBACK_SCENES;
      }
    }
    render();
  }

  function closeEditor() {
    editor.classList.add("hidden");
    editor.reset();
    clearSettingsSaveMessage(status);
  }

  select.addEventListener("change", updateSelectionDetails);
  newButton?.addEventListener("click", () => {
    editor.classList.remove("hidden");
    editor.reset();
    clearSettingsSaveMessage(status);
    idInput.focus();
  });
  cancelButton?.addEventListener("click", closeEditor);
  editor?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!invoke) {
      showSettingsSaveError(status, "Custom scenes can only be edited in the desktop app.");
      return;
    }
    const tools = toolsInput.value
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
    setSettingsSaveButtonSaving(saveButton, true);
    try {
      const profile = await invoke("save_scene_profile", {
        profile: {
          id: idInput.value.trim(),
          name: nameInput.value.trim(),
          description: descriptionInput.value.trim(),
          systemPrompt: promptInput.value.trim(),
          allowedTools: tools.length ? tools : null,
          builtin: false,
        },
      });
      persistSelectedScene(profile.id);
      closeEditor();
      await load();
    } catch (error) {
      showSettingsSaveError(status, error?.message || String(error));
    } finally {
      setSettingsSaveButtonSaving(saveButton, false);
    }
  });
  deleteButton?.addEventListener("click", async () => {
    const profile = selectedProfile();
    if (!invoke || !profile || profile.builtin !== false) return;
    if (!confirm(`Delete custom scene "${profile.name}"? Its isolated data will be preserved.`)) {
      return;
    }
    deleteButton.disabled = true;
    try {
      await invoke("delete_scene_profile", { sceneId: profile.id });
      persistSelectedScene("programming");
      await load();
    } finally {
      deleteButton.disabled = false;
    }
  });

  void load();
  return { load };
}
