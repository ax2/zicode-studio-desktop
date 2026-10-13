/** Keep the native tray aligned with the app's two supported interface languages. */
export function setupDesktopTrayLocale({ invoke, getLocale, onError = console.warn } = {}) {
  if (typeof invoke !== "function") return () => {};
  let pending = Promise.resolve();
  const sync = () => {
    const locale = getLocale();
    pending = pending.then(() => invoke("set_desktop_tray_locale", { locale }))
      .then(() => window.dispatchEvent(new CustomEvent("zicode:desktop-tray-locale-synced", { detail: { locale } })))
      .catch(onError);
  };
  window.addEventListener("zicode:locale-changed", sync);
  sync();
  return () => window.removeEventListener("zicode:locale-changed", sync);
}
