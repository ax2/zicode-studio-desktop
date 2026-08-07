export type SettingsTabKey =
  | "general"
  | "extensions"
  | "usage"
  | "configuration"
  | "remote-access"
  | "chat";

export interface SettingsTabDef {
  key: SettingsTabKey;
  /** i18n key used for the navigation label. */
  label: string;
}

export const SETTINGS_TABS: SettingsTabDef[] = [
  { key: "general", label: "General" },
  { key: "extensions", label: "Extensions" },
  { key: "usage", label: "Usage" },
  { key: "configuration", label: "Configuration" },
  { key: "remote-access", label: "Remote access" },
  { key: "chat", label: "Agent Inbox" },
];

const VALID_TAB_KEYS = new Set<string>(SETTINGS_TABS.map((tab) => tab.key));

export function normalizeSettingsTabKey(rawTabKey: unknown): SettingsTabKey {
  const raw = typeof rawTabKey === "string" ? rawTabKey : "general";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw || "general");
  } catch {
    decoded = raw || "general";
  }
  const mapped = decoded === "auth" ? "configuration" : decoded;
  return VALID_TAB_KEYS.has(mapped) ? (mapped as SettingsTabKey) : "general";
}

export function settingsHashForTab(tabKey: string): string {
  return `#/settings/${encodeURIComponent(normalizeSettingsTabKey(tabKey))}`;
}

export function isSettingsHash(hash: string): boolean {
  const route = hash.slice(1);
  return route === "/settings" || route.startsWith("/settings/");
}

export function tabFromSettingsHash(hash: string): SettingsTabKey {
  const route = hash.slice(1);
  if (route === "/settings") return "general";
  if (route.startsWith("/settings/")) {
    return normalizeSettingsTabKey(route.split("/")[2] || "general");
  }
  return "general";
}
