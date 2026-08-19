// Console/exception sweep across every enabled desktop app view.
//
// Visual QA covers layout; this harness covers the other half of broken UI:
// silent JS exceptions and console.error calls that never surface visually.
//
// Usage (app must be running on localhost):
//   node scripts/qa-console-errors.mjs <workspaceId> <sessionId>
//   APP_FILTER=notes node scripts/qa-console-errors.mjs <ws> <session>
//   VIEWPORT=390x844 node scripts/qa-console-errors.mjs <ws> <session>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 6000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("open", () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const requestId = ++id;
          pending.set(requestId, { res, rej });
          ws.send(JSON.stringify({ id: requestId, method, params }));
        });
      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (!message.id && message.method) {
          onEvent?.(message);
          return;
        }
        if (message.id && pending.has(message.id)) {
          const entry = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) entry.rej(new Error(JSON.stringify(message.error)));
          else entry.res(message.result);
        }
      });
      resolve({ send, close: () => ws.close() });
    });
    ws.addEventListener("error", (event) =>
      reject(new Error(String(event.message || "ws error"))),
    );
  });
}

const BENIGN_PATTERNS = [
  /favicon/i,
  /download the react devtools/i,
  /\[vite\]/i,
  /net::ERR_ABORTED/i,
  /DevTools listening/i,
];

function isBenign(text) {
  return BENIGN_PATTERNS.some((pattern) => pattern.test(text));
}

async function main() {
  const wsId = process.argv[2] || process.env.ZICODE_WORKSPACE;
  const sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!wsId || !sessionId) {
    throw new Error(
      "Usage: node scripts/qa-console-errors.mjs <workspaceId> <sessionId>",
    );
  }

  const enabledPlugins = new Set();
  try {
    const response = await fetch(`${HOST}/v2/plugins?sceneId=programming`);
    if (response.ok) {
      const body = await response.json();
      for (const plugin of body.plugins ?? []) {
        if (plugin.enabled) enabledPlugins.add(plugin.id);
      }
    }
  } catch {
    // Plugin state is optional; walk everything when unavailable.
  }

  const sessionUrl = `${HOST}/${sessionId}`;
  const candidates = [
    ["chat", `${sessionUrl}`],
    ["notes", `${sessionUrl}?app=com.zicode.notes`],
    ["projects", `${sessionUrl}?app=com.zicode.projects`],
    ["tasks", `${sessionUrl}?app=com.zicode.tasks`],
    ["automation", `${sessionUrl}?app=com.zicode.automation`],
    ["finance", `${sessionUrl}?app=com.zicode.finance`],
    ["graph", `${sessionUrl}?app=com.zicode.graph`],
    ["translate", `${sessionUrl}?app=com.zicode.translate`],
    ["habits", `${sessionUrl}?app=com.zicode.habits`],
    ["watch", `${sessionUrl}?app=com.zicode.watch`],
    ["ocr", `${sessionUrl}?app=com.zicode.ocr`],
    ["idphoto", `${sessionUrl}?app=com.zicode.idphoto`],
    ["imagetools", `${sessionUrl}?app=com.zicode.imagetools`],
    ["clipboard", `${sessionUrl}?app=com.zicode.clipboard`],
    ["documents", `${sessionUrl}?app=com.zicode.documents`],
    ["artifacts", `${sessionUrl}?app=com.zicode.artifacts`],
    ["articles", `${sessionUrl}?app=com.zicode.articles`],
    ["plugin-manager", `${sessionUrl}?app=core.pluginManager`],
    ["settings", `${sessionUrl}?app=core.settings`],
    ["help", `${sessionUrl}?app=core.help`],
  ];
  const filter = process.env.APP_FILTER;
  const apps = candidates.filter(([name, url]) => {
    if (filter && name !== filter) return false;
    if (enabledPlugins.size === 0) return true;
    const pluginId = new URL(url, HOST).searchParams.get("app");
    return !pluginId || pluginId.startsWith("core.") || enabledPlugins.has(pluginId);
  });

  const profile = mkdtempSync(join(tmpdir(), "zicode-console-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  try {
    let debugPort = null;
    let target = null;
    for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
      await sleep(200);
      if (!debugPort) {
        try {
          debugPort = readFileSync(join(profile, "DevToolsActivePort"), "utf8")
            .trim()
            .split("\n")[0];
        } catch {
          // Not ready yet.
        }
      }
      if (!debugPort) continue;
      try {
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((r) =>
          r.json(),
        );
        target = targets.find((candidate) => candidate.type === "page");
      } catch {
        // Not ready yet.
      }
    }
    if (!target) throw new Error("Could not discover a Chrome page target");

    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__qaConsole = [];
        const originalError = console.error.bind(console);
        const originalWarn = console.warn.bind(console);
        console.error = (...args) => {
          window.__qaConsole.push("error: " + args.map(String).join(" "));
          originalError(...args);
        };
        console.warn = (...args) => {
          window.__qaConsole.push("warn: " + args.map(String).join(" "));
          originalWarn(...args);
        };
        window.addEventListener("error", (event) => {
          window.__qaConsole.push("exception: " + (event.message || "uncaught error"));
        });
      })();`,
    });

    const viewport = process.env.VIEWPORT;
    if (viewport) {
      const [width, height] = viewport.split("x").map(Number);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 700,
      });
    }

    const report = [];
    for (const [name, url] of apps) {
      await cdp.send("Page.navigate", { url });
      await sleep(WAIT_MS);
      const result = await cdp.send("Runtime.evaluate", {
        expression: "window.__qaConsole ?? []",
        returnByValue: true,
      });
      const raw = Array.isArray(result?.result?.value) ? result.result.value : [];
      const entries = raw
        .map((line) => String(line))
        .filter((line) => !isBenign(line));
      const errors = [
        ...new Set(entries.filter((line) => !line.startsWith("warn:"))),
      ];
      const warnings = [
        ...new Set(entries.filter((line) => line.startsWith("warn:"))),
      ];
      report.push({ name, errors, warnings });
      console.log(
        JSON.stringify({
          name,
          errors,
          warnings,
          pass: errors.length === 0,
        }),
      );
    }

    const failures = report.filter((entry) => entry.errors.length > 0);
    console.log(
      `CONSOLE SWEEP: ${report.length - failures.length}/${report.length} views clean` +
        (failures.length > 0
          ? ` (${failures.map((entry) => entry.name).join(", ")} have errors)`
          : ""),
    );
    process.exitCode = failures.length > 0 ? 1 : 0;
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; Chrome may still hold the profile on Windows.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
