// Close only this Studio window, after its active app has released unsaved edits.
export function setupBrowserWindowClose({ shell, browser, invoke, report }) {
  if (!invoke) return;
  let closing = false;
  window.addEventListener("zicode:browser-window-close", async event => {
    event.preventDefault();
    if (closing) return;
    closing = true;
    try {
      const browserId = "com.zicode.browser";
      if (shell.getActivePluginId() !== browserId) {
        await shell.activate(browserId, { focus: false });
        if (shell.getActivePluginId() !== browserId) return;
      }
      await browser.finishWindowWrites();
      await invoke("browser_window_command", { action: "close" });
    } catch (error) { report(error); }
    finally { closing = false; }
  });
}
