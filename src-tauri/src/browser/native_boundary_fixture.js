async function inspectBoundary(arm) {
  const studioGlobals = ["__TAURI__", "__TAURI_INTERNALS__", "__zicodeDesktopToken"].some(name => name in globalThis);
  try {
    globalThis.chrome?.webview?.postMessage("Studio isolated test marker");
  } catch { /* The native bridge is disabled for browser documents. */ }
  const normal = await fetch("/ready/" + arm);
  let excluded;
  try {
    const response = await fetch(blockedOrigin + "/excluded/" + arm);
    excluded = !response.ok;
  } catch {
    excluded = true;
  }
  return { studioGlobals, excluded, ordinary: await normal.text(), origin: globalThis.origin };
}

if (typeof document === "undefined") {
  inspectBoundary("worker").then(result => postMessage(result));
} else if (window.parent !== window) {
  const arm = location.pathname.slice(1);
  inspectBoundary(arm).then(result => parent.postMessage(result, "*"));
} else {
  async function frameResult(arm) {
    const frame = document.createElement("iframe");
    if (arm === "sandboxed") frame.sandbox = "allow-scripts";
    frame.src = "/" + arm;
    return new Promise(resolve => {
      function received(event) {
        if (event.source !== frame.contentWindow) return;
        window.removeEventListener("message", received);
        resolve(event.data);
      }
      window.addEventListener("message", received);
      document.body.append(frame);
    });
  }
  const worker = new Worker("/check.js");
  Promise.all([
    inspectBoundary("document"),
    frameResult("frame"),
    frameResult("sandboxed"),
    new Promise(resolve => { worker.onmessage = event => resolve(event.data); }),
  ]).then(([document, frame, sandboxed, workerReport]) => {
    worker.terminate();
    globalThis.boundaryReport = { document, frame, sandboxed, worker: workerReport };
  });
}
