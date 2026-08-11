import { t } from "./i18n.js";

// The Rust host wraps failed Pi RPC calls with stable English messages (for
// example "Pi RPC request failed: ProcessClosed"). A closed runtime is a
// recoverable state: creating a new session reconnects. Every feature store
// should route host errors through `localizeHostError` so the Chinese UI
// never shows raw English internals and instead tells the user the recovery
// action.
export function isRuntimeProcessClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ProcessClosed|process\s+(is\s+)?closed/i.test(message);
}

export function localizeHostError(error: unknown): Error {
  if (isRuntimeProcessClosedError(error)) {
    return new Error(
      t("Pi runtime is disconnected. Start a new session to reconnect."),
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}
