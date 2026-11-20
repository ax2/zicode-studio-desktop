// Native tray navigation never starts monitoring or requests elevation.
export function setupSystemInformationShortcut({ listen, openSettings, onError = console.warn }) {
  if (typeof listen !== "function") return () => {};
  let disposed = false;
  let stop;
  Promise.resolve(listen("studio-open-system-information", () => {
    if (!disposed) openSettings("system");
  })).then(unlisten => {
    if (disposed) unlisten(); else stop = unlisten;
  }).catch(onError);
  return () => { disposed = true; stop?.(); };
}
