import { t } from "../../i18n.js";

// The Host-built prompt is the exact outbound user message. Keep it in the
// trusted parent dialog; the opaque View never receives the one-shot grant.
export async function confirmPluginModelGeneration(preview, pluginName, showDialog,
  container = document.getElementById("dialog-container")) {
  if (!container?.classList.contains("hidden") || typeof showDialog !== "function" ||
    typeof preview?.promptPreview !== "string" || typeof preview.destination !== "string" ||
    typeof preview.displayName !== "string" || typeof preview.inputBytes !== "number") return false;
  let formatted;
  try { formatted = JSON.stringify(JSON.parse(preview.promptPreview), null, 2); }
  catch { return false; }
  const send = t("Send to model");
  const safeName = String(pluginName ?? "Plugin").replace(/\s+/g, " ").slice(0, 128);
  const heading = t("Send {bytes} bytes from {plugin} to {model} at {destination}?")
    .replace("{bytes}", String(preview.inputBytes)).replace("{plugin}", safeName)
    .replace("{model}", preview.displayName.replace(/\s+/g, " "))
    .replace("{destination}", preview.destination);
  const title = `${heading}\n\n--- 1. ${t("Data to send")} preview ---\n${formatted}`;
  const timeout = Number.isFinite(preview.expiresInMs)
    ? Math.max(1, Math.min(preview.expiresInMs, 120_000)) : 120_000;
  const response = await showDialog({ method: "select", title, options: [send], timeout }, container);
  return response?.value === send;
}
