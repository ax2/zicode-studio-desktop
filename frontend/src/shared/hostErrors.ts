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
      t("Pi runtime is disconnected. Start a new session to reconnect."),
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
  // Web Watch: URL validation.
  if (
    /url is invalid|only http and https|url has no host|url host cannot be resolved|url host resolves to a private/.test(
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
  // Translation: missing model key.
  if (/translation model key is not configured/.test(lowered)) {
    return t("The translation model is not configured for this scene.");
  }
  // Translation: unreachable or empty model gateway response.
  if (
    /model gateway is unreachable|cannot build model client|model gateway error|cannot read model response|model returned an empty/.test(
      lowered,
    )
  ) {
    return t("The translation service is temporarily unavailable.");
  }
  // Translation: text length (before the generic "exceeds" file check).
  if (/character (translation )?limit|text exceeds/.test(lowered)) {
    return t("The text is too long.");
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
  if (/cannot open|cannot read/.test(lowered)) {
    return t("The file could not be read.");
  }
  return message;
}
