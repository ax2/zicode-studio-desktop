// Browser acceptance for the frozen Trace View through the real Studio Host and Worker.
// The Rust host test passes its temporary address and token on stdin.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromePath = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function jsonWhenReady(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch { /* Chrome is still starting. */ }
    await pause(100);
  }
  throw new Error("Chromium debugging endpoint did not start");
}

function connect(url, onEvent) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 0;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        return new Promise((done, fail) => {
          const id = ++nextId;
          pending.set(id, { done, fail });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const task = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) task.fail(new Error(message.error.message));
        else task.done(message.result);
      } else if (message.method) onEvent(message);
    });
    socket.addEventListener("error", () => reject(new Error("Chromium debugging socket failed")));
  });
}

async function evaluate(cdp, contextId, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    contextId, expression, returnByValue: true, awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function until(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await check();
    if (value) return value;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  const input = [];
  for await (const chunk of process.stdin) input.push(chunk);
  const { origin, desktopToken, screenshotDir } = JSON.parse(Buffer.concat(input).toString("utf8"));
  const port = await availablePort();
  const profile = mkdtempSync(join(tmpdir(), "zicode-trace-view-"));
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`, "--remote-allow-origins=*", "about:blank"],
  { stdio: "ignore", windowsHide: true });
  let cdp;
  let frameCdp;
  try {
    const targets = await jsonWhenReady(`http://127.0.0.1:${port}/json`);
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("Chromium page target missing");
    const contexts = new Set();
    const errors = [];
    const networkErrors = [];
    cdp = await connect(page.webSocketDebuggerUrl, (event) => {
      if (event.method === "Runtime.executionContextCreated") contexts.add(event.params.context.id);
      if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
      if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error")
        errors.push(event.params.args.map((arg) => arg.value ?? arg.description).join(" "));
      if (event.method === "Network.responseReceived" && event.params.response.status >= 400)
        networkErrors.push(`${event.params.response.status} ${event.params.response.url}`);
      if (event.method === "Network.loadingFailed") networkErrors.push(event.params.errorText);
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Page.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1180, height: 800, deviceScaleFactor: 1, mobile: false });
    // Credentials remain in this process and the top-level page; the sandboxed plugin never receives them.
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `if (location.origin === ${JSON.stringify(origin)}) {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, options = {}) => {
        const headers = new Headers(options.headers);
        headers.set("x-zicode-desktop-token", ${JSON.stringify(desktopToken)});
        return originalFetch(input, { ...options, headers });
      };
    }` });
    await cdp.send("Page.navigate", { url: `${origin}/?plugin=com.zicode.devtools.trace` });
    await until(async () => {
      const browserTargets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
      const target = browserTargets.find((item) => item.type === "iframe" && item.url === "about:srcdoc");
      if (!target?.webSocketDebuggerUrl) return false;
      frameCdp ??= await connect(target.webSocketDebuggerUrl, (event) => {
        if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
      });
      await frameCdp.send("Runtime.enable");
      return evaluate(frameCdp, undefined, "!!document.getElementById('run')");
    }, "Trace plugin View").catch(async (error) => {
      const pages = [];
      for (const id of contexts) {
        try {
          pages.push(await evaluate(cdp, id, `Promise.all([
            fetch('/v2/plugins?sceneId=programming').then(async r => {
              const plugin = (await r.json()).plugins.find(p => p.id === 'com.zicode.devtools.trace');
              return { status: r.status, trace: plugin && { id: plugin.id, enabled: plugin.enabled } };
            }).catch(e => String(e)),
            Promise.resolve({ url: location.href, text: document.body?.innerText?.slice(0, 300),
              content: document.getElementById('content')?.innerHTML.slice(0, 300),
              resources: performance.getEntriesByType('resource').map(x => x.name).slice(-15) })
          ])`));
        } catch { /* A context may have been replaced by navigation. */ }
      }
      const targets = await cdp.send("Target.getTargets");
      const tree = await cdp.send("Page.getFrameTree");
      throw new Error(`${error.message}; pages=${JSON.stringify(pages)}; targets=${JSON.stringify(targets.targetInfos.map(x => ({ type: x.type, url: x.url })))}; frames=${JSON.stringify(tree)}; errors=${JSON.stringify(errors)}; network=${JSON.stringify(networkErrors)}`);
    });
    await until(async () => (await evaluate(frameCdp, undefined, "document.getElementById('status').textContent")) === "可以处理文本。", "View SDK context");
    const results = [];
    for (const [operation, expected] of [["java.trace", "NullPointerException"], ["django.trace", "NoReverseMatch"]]) {
      await evaluate(frameCdp, undefined, `(() => {
        const select = document.getElementById('operation');
        select.value = ${JSON.stringify(operation)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('sample').click();
        document.getElementById('run').click();
      })()`);
      const result = await until(async () => {
        const value = await evaluate(frameCdp, undefined, `({ status: document.getElementById('status').textContent,
          output: document.getElementById('output').textContent,
          error: document.getElementById('status').dataset.error })`);
        if (value.error === "true") throw new Error(`Trace ${operation}: ${value.status}`);
        return value.status === "处理完成。" ? value : null;
      }, `${operation} result`);
      if (!result.output.includes(expected)) throw new Error(`${operation} output did not contain expected trace marker`);
      results.push({ operation, displayed: true, expectedMarker: expected });
    }
    mkdirSync(screenshotDir, { recursive: true });
    const screenshots = [];
    for (const width of [1180, 390]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      await pause(200);
      const capture = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const path = join(screenshotDir, `trace-studio-view-${width}x800.png`);
      writeFileSync(path, Buffer.from(capture.data, "base64"));
      screenshots.push(path);
    }
    if (errors.length) throw new Error(`Chromium runtime exception: ${errors[0]}`);
    process.stdout.write(`${JSON.stringify({ passed: true, results, screenshots })}\n`);
  } finally {
    frameCdp?.close();
    cdp?.close();
    chrome.kill();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try { rmSync(profile, { recursive: true, force: true }); break; }
      catch { await pause(300); }
    }
  }
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
