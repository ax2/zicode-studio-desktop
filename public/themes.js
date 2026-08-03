/**
 * Theme system shared by every workspace window.
 *
 * Storage note: the active theme is persisted in a cookie (not
 * localStorage). ZiCode Studio Desktop spawns one pi process per workspace, each on
 * its own port, and every workspace window is loaded from
 * `http://localhost:<port>`. localStorage is partitioned per origin, so
 * `localhost:3001` and `localhost:3002` would each see a different
 * `pi-studio-theme` value — meaning any new project window would forget
 * the user's theme and fall back to the OS default (usually dark). Cookies
 * on `localhost` are shared across ports, so a single cookie is visible
 * to every workspace window.
 */

export const themes = {
  night: {
    name: { "zh-CN": "石墨深色", en: "Graphite Dark" },
    dark: true,
    themeColor: "#212121",
    vars: {},
  },
  dawn: {
    name: { "zh-CN": "雾蓝深色", en: "Mist Blue Dark" },
    dark: true,
    themeColor: "#1a1d26",
    vars: {},
  },
  midnight: {
    name: { "zh-CN": "纯黑深色", en: "Midnight Black" },
    dark: true,
    themeColor: "#000000",
    vars: {},
  },
  clean: {
    name: { "zh-CN": "明亮白色", en: "Bright White" },
    dark: false,
    themeColor: "#ffffff",
    vars: {},
  },
  terracotta: {
    name: { "zh-CN": "暖砂浅色", en: "Warm Sand" },
    dark: false,
    themeColor: "#f4f1ec",
    vars: {},
  },
  sage: {
    name: { "zh-CN": "鼠尾草浅色", en: "Sage Light" },
    dark: false,
    themeColor: "#f0f2ec",
    vars: {},
  },
};

// TODO(rename->picot): cookie key kept as `pi-studio-theme` for backward compat — changing it would reset all existing users' theme preference.
const THEME_COOKIE = "pi-studio-theme";
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

function readThemeCookie() {
  try {
    const cookies = document.cookie ? document.cookie.split("; ") : [];
    for (const entry of cookies) {
      const eq = entry.indexOf("=");
      if (eq === -1) continue;
      const name = entry.slice(0, eq);
      if (name !== THEME_COOKIE) continue;
      const raw = entry.slice(eq + 1);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  } catch {
    // document.cookie can throw in sandboxed contexts; treat as missing.
  }
  return null;
}

function writeThemeCookie(themeId) {
  try {
    const value = encodeURIComponent(themeId);
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is async and not suitable for synchronous theme persistence
    document.cookie = `${THEME_COOKIE}=${value}; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
  } catch {
    // ignore — same fallback as the read path
  }
}

// One-time migration: lift any previously saved value out of the per-origin
// localStorage and into the cross-port cookie. Old key is left in place so
// downgrades stay readable; new writes always go to the cookie.
function migrateLegacyLocalStorageValue() {
  try {
    if (readThemeCookie()) return;
    const legacy = localStorage.getItem(THEME_COOKIE);
    if (legacy) writeThemeCookie(legacy);
  } catch {
    // localStorage may be unavailable; nothing to migrate
  }
}

migrateLegacyLocalStorageValue();

export function applyTheme(themeId) {
  const root = document.documentElement;
  if (!themes[themeId]) themeId = "clean";
  root.setAttribute("data-theme", themeId);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themes[themeId].themeColor);
  writeThemeCookie(themeId);
}

export function getCurrentTheme() {
  const saved = readThemeCookie();
  if (saved === "dark") return "night";
  if (saved === "light") return "clean";
  if (saved && themes[saved]) return saved;
  return "clean";
}

// Track OS theme changes only when the user hasn't picked a theme yet.
// As soon as a cookie exists (set by applyTheme) this listener becomes a
// no-op, so the user's explicit choice wins.
if (!readThemeCookie()) {
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", (e) => {
    if (!readThemeCookie()) {
      const root = document.documentElement;
      root.setAttribute("data-theme", e.matches ? "clean" : "night");
    }
  });
}
