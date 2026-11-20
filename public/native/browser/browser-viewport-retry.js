export function isBrowserViewportMismatch(error) {
  return String(error?.message ?? error) === "Browser viewport must fit inside its owner window";
}

// Creation keeps the controller hidden. If the DOM and owner disagree while
// resizing, initialize it at a safe size and use fresh bounds when presenting.
export async function createHiddenBrowserView(create, preferredBounds) {
  try {
    return await create(preferredBounds);
  } catch (error) {
    if (!isBrowserViewportMismatch(error)) throw error;
    return create({ x: 0, y: 0, width: 1, height: 1 });
  }
}

// A native resize may finish between DOM measurement and IPC handling.
// Re-read geometry on the next frame, without weakening the Host bounds check.
export async function withBrowserViewportRetry(work, current = () => true) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!current()) return;
    try { return await work(); }
    catch (error) {
      if (!isBrowserViewportMismatch(error) || attempt === 2) throw error;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
}
