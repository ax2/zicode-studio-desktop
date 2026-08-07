export interface InstalledApp {
  id: string;
  label: string;
  appName?: string;
  command?: string;
}

export const STORAGE_KEY = "picot-open-app";

const MONOGRAMS: Record<string, string> = {
  vscode: "VS",
  cursor: "C",
  webstorm: "WS",
  zed: "Z",
  terminal: "T",
  ghostty: "G",
  finder: "F",
};

const ICONS: Record<string, string> = {
  vscode: "icons/app-vscode.png",
  cursor: "icons/app-cursor.svg",
  webstorm: "icons/app-webstorm.svg",
  zed: "icons/app-zed.png",
  terminal: "icons/app-terminal.svg",
  ghostty: "icons/app-ghostty.png",
  finder: "icons/app-finder.png",
};

export function logoForApp(
  app: InstalledApp | null | undefined,
): { type: "img"; src: string } | { type: "text"; label: string } {
  if (!app) return { type: "text", label: "•" };
  const icon = ICONS[app.id];
  if (icon) return { type: "img", src: icon };
  const label = MONOGRAMS[app.id] || app.label?.slice(0, 1).toUpperCase() || "•";
  return { type: "text", label };
}
