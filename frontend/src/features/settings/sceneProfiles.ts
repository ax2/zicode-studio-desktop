export interface SceneProfile {
  id: string;
  name: string;
  description?: string;
  builtin?: boolean;
}

export const fallbackSceneProfiles: SceneProfile[] = [
  {
    id: "programming",
    name: "Programming",
    description:
      "Engineering workflows for coding, debugging, repository changes, and reproducible verification.",
    builtin: true,
  },
  {
    id: "finance",
    name: "Finance",
    description:
      "Evidence-led financial analysis with explicit assumptions and a read-only local tool policy.",
    builtin: true,
  },
  {
    id: "creation",
    name: "Creation",
    description:
      "Structured writing, ideation, visual direction, and iterative content production.",
    builtin: true,
  },
];

const STORAGE_KEY = "pi-desktop:selected-scene";
const COOKIE_KEY = "zicode-studio-scene";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;

export function normalizeSceneId(value: unknown): string {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(text) ? text : "programming";
}

export function getSelectedSceneId(): string {
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

export function persistSelectedScene(sceneId: string): void {
  try {
    // biome-ignore lint/suspicious/noDocumentCookie: cross-port desktop preference storage
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(sceneId)}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
    localStorage.setItem(STORAGE_KEY, sceneId);
  } catch {
    // Keep the in-memory select usable even when persistence is unavailable.
  }
}
