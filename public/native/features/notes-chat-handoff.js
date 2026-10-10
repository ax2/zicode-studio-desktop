import { t } from "../../i18n.js";

function promptFor(note, selection) {
  const tagsLine =
    Array.isArray(note.tags) && note.tags.length > 0
      ? `${t("Note tags")}: ${note.tags.join(", ")}`
      : "";
  const sourceLine = note.source?.url ? `${t("Source")}: ${note.source.url}` : "";
  let prompt;
  if (selection) {
    prompt = [
      t(
        'Discuss the selected text from note "{title}", only around this text, ignoring stale context:',
      ).replace("{title}", note.title),
      tagsLine,
      sourceLine,
      "",
      selection,
      "",
      `${t("I want to continue")}:`,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    const reference = `zicode-note://${note.notebookId}/${note.id}`;
    prompt = [
      t('Discuss note "{title}" and continue.').replace("{title}", note.title),
      t(
        "First call notes_get with notebookId={notebookId}, noteId={noteId}, ignoring stale chat context.",
      )
        .replace("{notebookId}", note.notebookId)
        .replace("{noteId}", note.id),
      `${t("Note reference")}: ${reference}`,
      tagsLine,
      sourceLine,
      `\n${t("I want to continue")}:`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return prompt;
}

export function createNotesChatHandoff({ activate, getTarget, isChatActive, getInput, syncDraft }) {
  const targetKey = () => {
    const target = getTarget();
    return JSON.stringify([
      target?.sceneId,
      target?.workspaceId,
      target?.instanceId,
      target?.sessionId,
    ]);
  };
  return async (note, selection = "", scope) => {
    const capturedTarget = getTarget();
    const captured = targetKey();
    const current = () =>
      Boolean(scope?.isCurrent()) && capturedTarget === getTarget() && captured === targetKey();
    if (!current()) return;
    const prompt = promptFor(note, selection);
    await activate();
    if (!current() || !isChatActive()) return;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!current() || !isChatActive()) return;
      const input = getInput();
      if (input) {
        input.value = `${prompt}${input.value.trim() ? `\n${input.value.trim()}` : ""}`;
        syncDraft();
        input.focus();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(t("The Chat input is unavailable. Return to Notes and try again."));
  };
}
