import { t } from "../../i18n.js";

// Writes only to the current composer. The caller chooses when to send the draft.
export function createChatDraftHandoff({ activate, getTarget, isChatActive, getInput, syncDraft }) {
  let pending = false;
  const key = (target) =>
    JSON.stringify([target?.sceneId, target?.workspaceId, target?.instanceId, target?.sessionId]);
  return async ({ workspace, scene, prompt, isCurrent }) => {
    if (pending) throw new Error(t("A chat draft handoff is already in progress."));
    const captured = getTarget();
    const capturedKey = key(captured);
    if (
      !workspace ||
      captured?.workspaceId !== workspace ||
      (scene !== undefined && (captured?.sceneId || "programming") !== scene) ||
      !captured?.sessionId ||
      typeof prompt !== "string" ||
      !prompt.trim()
    ) {
      throw new Error(t("Open a chat session in this project before preparing a draft."));
    }
    const current = () =>
      captured === getTarget() && capturedKey === key(getTarget()) && (!isCurrent || isCurrent());
    const ensureCurrent = () => {
      if (!current() || !isChatActive())
        throw new Error(
          t("The source or chat target changed. Return to the source view and try again."),
        );
    };
    pending = true;
    try {
      if (!current())
        throw new Error(
          t("The source or chat target changed. Return to the source view and try again."),
        );
      await activate();
      ensureCurrent();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        ensureCurrent();
        const input = getInput();
        if (input?.isConnected && !input.disabled && !input.readOnly) {
          const previous = input.value;
          const next = previous ? `${previous}\n\n${prompt}` : prompt;
          const maximum = input.maxLength >= 0 ? input.maxLength : 1024 * 1024;
          if (next.length > Math.min(maximum, 1024 * 1024)) {
            throw new Error(
              t(
                "The combined chat draft is too long. Shorten the existing draft or select less source material.",
              ),
            );
          }
          ensureCurrent();
          input.value = next;
          // Notify existing composer state, sizing and draft persistence listeners.
          const EventCtor = input.ownerDocument.defaultView?.Event ?? Event;
          input.dispatchEvent(new EventCtor("input", { bubbles: true }));
          input.focus();
          input.setSelectionRange?.(previous.length, next.length);
          try {
            syncDraft();
          } catch {
            throw new Error(
              t(
                "The content was inserted, but draft recovery could not be updated. Check the input before preparing it again.",
              ),
            );
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(t("The chat input is unavailable. Return to the project and try again."));
    } finally {
      pending = false;
    }
  };
}
