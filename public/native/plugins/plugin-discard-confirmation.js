// Reuse Studio's application dialog. Never replace an active Pi/user dialog.
export async function confirmPluginDiscard(message, showDialog, container = document.getElementById("dialog-container")) {
  if (!container?.classList.contains("hidden")) return false;
  const response = await showDialog({ method: "confirm", title: message }, container);
  return response?.confirmed === true;
}
