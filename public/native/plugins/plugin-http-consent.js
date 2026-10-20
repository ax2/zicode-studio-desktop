import { t } from "../../i18n.js";

export async function confirmPluginHttpGet(preview, pluginName, showDialog,
  container = document.getElementById("dialog-container"), dismissSignal) {
  const display = preview?.display;
  if (!container?.classList.contains("hidden") || typeof showDialog !== "function" ||
    typeof display?.origin !== "string" || typeof display?.path !== "string" ||
    typeof display?.endpoint !== "string" || !["public", "private", "loopback", "hostname"].includes(display.addressClass) ||
    typeof display?.https !== "boolean" || display.maxResponseBytes !== 1_048_576 ||
    display.timeoutMs !== 8_000 || preview?.operationId == null || preview?.grantId == null) return false;
  const safeName = String(pluginName ?? "Plugin").replace(/\s+/g, " ").slice(0, 128);
  const lines = [
    t("Allow this plugin to read from a service?"),
    `${t("Plugin")}: ${safeName}`,
    `${t("Service origin")}: ${display.origin}`,
    `${t("Request")}: GET ${display.path} (${display.endpoint})`,
    `${t("Network")}: ${t(display.addressClass)}`,
    `${t("Response limit")}: ${display.maxResponseBytes} bytes · ${display.timeoutMs} ms`,
    ...(display.addressClass === "hostname" ? [t("The hostname is resolved only after approval. Private or loopback results are blocked; use localhost or a literal IP for local services.")] : []),
    t("No credentials, cookies, request body, or proxy are used."),
    display.https ? t("TLS certificate validation is enabled.") : t("This local HTTP request is not encrypted."),
  ];
  const response = await showDialog({
    method: "confirm",
    title: lines.join("\n"),
    timeout: Math.min(60_000, Math.max(1, Number(preview.expiresInMs) || 60_000)),
  }, container, { dismissSignal });
  return response?.confirmed === true;
}
