import { t } from "./i18n.js";

// The Rust host wraps failed Pi RPC calls with stable English messages (for
// example "Pi RPC request failed: ProcessClosed", "ZiCode Studio Desktop Host
// runtime is disconnected", or "runtime_stopped"). A closed/stopped runtime is
// a recoverable state: creating a new session reconnects. Every feature store
// should route host errors through `localizeHostError` so the Chinese UI never
// shows raw English internals and instead tells the user the recovery action.
export function isRuntimeProcessClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /ProcessClosed|process\s+(?:is\s+)?closed/i.test(message) ||
    /\b(?:runtime|host|adapter)\b[^.\n]*?\b(disconnected|stopped|unavailable|no longer active)\b/i.test(
      message,
    )
  );
}

export function localizeHostError(error: unknown): Error {
  if (isRuntimeProcessClosedError(error)) {
    return new Error(
      t("Pi runtime is disconnected. Try again or start a new session."),
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

// Plugin backends return stable English messages for invalid input (for
// example "Cannot decode image", "Unsupported document type"). Most invalid
// input is already rejected in the frontend, but a corrupted file that passes
// the MIME check still reaches the backend. Map those leftovers to friendly
// localized text instead of showing raw English internals.
export function friendlyPluginError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  // Web Watch / Notes capture: URL validation.
  if (
    /url is invalid|only http and https|url has no host|url host cannot be resolved|url host resolves to a private|enter a valid http/.test(
      lowered,
    )
  ) {
    return t("The URL is invalid or cannot be accessed.");
  }
  // Web Watch: page fetch failures (before the generic "cannot read" below).
  if (
    /page is unreachable|cannot read page body|cannot build web client|page returned http|page exceeds/.test(
      lowered,
    )
  ) {
    return t("The page could not be reached.");
  }
  // Notes web capture: network-level failure reaching the page (proxy/offline).
  if (
    /cannot retrieve the web page|cannot initialize web capture|cannot resolve the web page host|web page download failed/.test(
      lowered,
    )
  ) {
    return t("Cannot retrieve the page. Check your network or proxy settings.");
  }
  // Notes web capture: the URL points at a private/loopback address.
  if (/loopback and private network|only credential-free http/.test(lowered)) {
    return t(
      "This URL is not allowed. Internal and private network addresses cannot be captured.",
    );
  }
  // Translation: missing model key.
  if (/translation model key is not configured/.test(lowered)) {
    return t("The translation model is not configured for this scene.");
  }
  // Translation: the gateway could not be reached at the network level. This is
  // almost always a proxy/offline problem, so point the user there instead of
  // implying the service itself is down.
  if (/model gateway is unreachable|cannot build model client/.test(lowered)) {
    return t(
      "Cannot reach the translation service. Check your network or proxy settings.",
    );
  }
  // Translation: the gateway answered but rejected the request, or returned an
  // empty result.
  if (
    /model gateway error|cannot read model response|model returned an empty/.test(
      lowered,
    )
  ) {
    return t("The translation service is temporarily unavailable.");
  }
  // Translation: text length (before the generic "exceeds" file check).
  if (/character (translation )?limit|text exceeds/.test(lowered)) {
    return t("The text is too long.");
  }
  // Finance: QVeris backend errors surface through the workbench gateway.
  if (/qveris api key is not configured/.test(lowered)) {
    return t("The QVeris API key is not configured for this scene.");
  }
  if (/qveris request timed out/.test(lowered)) {
    return t("The QVeris request timed out. Please try again.");
  }
  if (/qveris request failed/.test(lowered)) {
    return t("The QVeris request failed.");
  }
  if (/qveris returned an invalid/.test(lowered)) {
    return t("QVeris returned an invalid response.");
  }
  if (/qveris response exceeded/.test(lowered)) {
    return t("The QVeris response exceeded the safety limit.");
  }
  // Watch/Habits: missing record.
  if (/watcher not found|habit not found/.test(lowered)) {
    return t("The item was not found.");
  }
  if (/cannot decode|invalid base64|invalid data|corrupt/.test(lowered)) {
    return t("The file could not be decoded.");
  }
  if (/unsupported (document|file|type|image)/.test(lowered)) {
    return t("This file type is not supported.");
  }
  if (/exceeds|too (large|big)|byte limit/.test(lowered)) {
    return t("The file is too large.");
  }
  if (/unknown (sheet|template)|not found/.test(lowered)) {
    return t("The selected option is not available.");
  }
  if (/cannot open|cannot read|cannot extract|cannot locate/.test(lowered)) {
    return t("The file could not be read.");
  }
  if (/no text was recognized/.test(lowered)) {
    return t("No text was recognized in the image");
  }
  if (
    /ocr is only available|cannot start windows ocr|cannot prepare image for ocr|windows ocr failed/.test(
      lowered,
    )
  ) {
    return t("The text extraction service is unavailable on this device.");
  }
  // Image / clipboard / habits: missing required input.
  if (/at least one image is required|habit name is required/.test(lowered)) {
    return t("The input is empty or incomplete.");
  }
  if (/clipboard text is empty/.test(lowered)) {
    return t("Clipboard is empty");
  }
  // Habits: count and date limits.
  if (/maximum of \d+ habits has been reached/.test(lowered)) {
    return t("The maximum number of habits has been reached.");
  }
  if (/habit date must use yyyy-mm-dd/.test(lowered)) {
    return t("The date must use the YYYY-MM-DD format.");
  }
  // Documents: a scanned PDF without a text layer.
  if (/no text could be extracted from this document/.test(lowered)) {
    return t("No text could be extracted from this document.");
  }
  // Article publishing: WeChat / blog configuration and connectivity.
  if (/wechat appid or appsecret is not configured/.test(lowered)) {
    return t("The WeChat AppID or AppSecret is not configured.");
  }
  if (/blog server host, username, and password are not configured/.test(lowered)) {
    return t("The blog server host, username, or password is not configured.");
  }
  if (/blog server remote directory is not configured/.test(lowered)) {
    return t("The blog server remote directory is not configured.");
  }
  if (/article has not been synced to a wechat draft yet/.test(lowered)) {
    return t("The article has not been synced to a WeChat draft yet.");
  }
  if (/blog server rejected the username or password/.test(lowered)) {
    return t("The blog server rejected the username or password.");
  }
  if (/blog server authentication failed/.test(lowered)) {
    return t("Blog server authentication failed.");
  }
  if (/cannot connect to blog server/.test(lowered)) {
    return t("Cannot connect to the blog server.");
  }
  if (/source blog directory does not exist/.test(lowered)) {
    return t("The blog source directory does not exist.");
  }
  if (/wechat error \d+/.test(lowered) || /wechat request failed/.test(lowered)) {
    return t("The WeChat request failed. Check the AppID/AppSecret and network.");
  }
  if (/article publishing is not enabled|plugin_not_enabled/.test(lowered)) {
    return t("Enable the Articles plugin to use publishing.");
  }
  if (/cannot create|cannot serialize|cannot save|cannot encode/.test(lowered)) {
    return t("The operation could not be completed.");
  }
  return message;
}

// Background task dispatch (Agent Inbox / automations) can fail with raw
// client-side JavaScript errors such as "getSelectedSceneId is not defined"
// (a forgotten import) or a TypeError from a stale bundle. Those messages are
// meaningless to end users, so the task center and automation history map them
// to a friendly retry prompt while keeping the technical detail available for
// support (the original string is preserved in the task data and tooltips).
const INTERNAL_DISPATCH_ERROR = /(?:is not defined|ReferenceError|TypeError|SyntaxError|undefined is not a function|cannot read properties of (?:undefined|null)|unexpected token)/i;

export function friendlyTaskDispatchError(reason: string): string {
  if (!reason) return "";
  return INTERNAL_DISPATCH_ERROR.test(reason)
    ? t("Task dispatch failed due to an internal error")
    : reason;
}
