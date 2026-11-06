// A native resize may finish between DOM measurement and IPC handling.
// Re-read geometry on the next frame, without weakening the Host bounds check.
export async function withBrowserViewportRetry(work, current = () => true) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!current()) return;
    try { return await work(); }
    catch (error) {
      if (String(error?.message ?? error) !== "Browser viewport must fit inside its owner window" || attempt === 2) throw error;
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  }
}
