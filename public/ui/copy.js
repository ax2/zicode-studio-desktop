/**
 * WebView2-safe text copying.
 *
 * The desktop WebView denies async Clipboard API writes (Tauri's wry layer
 * only grants the read permission), so `navigator.clipboard.writeText` stays
 * pending forever and copy buttons would silently do nothing. Try the async
 * API with a short timeout first (it works in browsers and on mobile), then
 * fall back to a hidden textarea + `document.execCommand("copy")`, which the
 * desktop WebView honors under a real user gesture.
 */
export async function copyText(text, { timeoutMs = 600 } = {}) {
  const value = String(text ?? "");
  try {
    if (navigator.clipboard?.writeText) {
      const succeeded = await Promise.race([
        navigator.clipboard.writeText(value).then(
          () => true,
          () => false,
        ),
        new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
      ]);
      if (succeeded) return true;
    }
  } catch {
    // Fall through to the execCommand path.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.cssText = "position:fixed;left:-9999px;top:0;";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}
