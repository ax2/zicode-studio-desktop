#!/usr/bin/env node
// Isolated probe for the session sidebar: loads the chat page and polls the
// #session-list container over 10s with no interactions, so we can tell
// whether the sidebar renders on a clean load in a browser context.
//
// Usage (app must be running on localhost):
//   node scripts/qa-session-sidebar.mjs <workspaceId> <sessionId>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(wsUrl) {
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

async function main() {
  const wsId = process.argv[2] || process.env.ZICODE_WORKSPACE;
  const sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!wsId || !sessionId) {
    throw new Error(
      "Usage: node scripts/qa-session-sidebar.mjs <workspaceId> <sessionId>",
    );
  }

  const profile = mkdtempSync(join(tmpdir(), "zicode-sidebar-"));
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
        window.__qaErrors = [];
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
        window.__qaGetElementCalls = [];
        const originalGetElementById = document.getElementById.bind(document);
        document.getElementById = (id, ...rest) => {
          const result = originalGetElementById(id, ...rest);
          if (id === "session-list") {
            window.__qaGetElementCalls.push({
              at: Date.now(),
              found: Boolean(result),
            });
          }
          return result;
        };
        window.__qaSidebarMutations = [];
        const observeSidebar = () => {
          const list = originalGetElementById("session-list");
          if (!list || list.__qaObserved) return;
          list.__qaObserved = true;
          new MutationObserver((records) => {
            for (const record of records) {
              window.__qaSidebarMutations.push({
                at: Date.now(),
                type: record.type,
                added: record.addedNodes.length,
                removed: record.removedNodes.length,
              });
            }
          }).observe(list, { childList: true, subtree: true });
        };
        observeSidebar();
        setInterval(observeSidebar, 500);
        window.addEventListener("error", (event) => {
          window.__qaErrors.push(String(event.message || "page error"));
        });
        window.addEventListener("unhandledrejection", (event) => {
          window.__qaErrors.push(
            String(event.reason?.message || event.reason || "unhandled rejection"),
          );
        });
      })()`,
    });
    const url = `${HOST}/app/workspaces/${wsId}/sessions/${sessionId}`;
    await cdp.send("Page.navigate", { url });

    const samples = [];
    for (let second = 0; second < 12; second += 1) {
      await sleep(1000);
      const evaluated = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const list = document.querySelector("#session-list");
          return {
            children: list?.childElementCount ?? -1,
            text: (list?.textContent ?? "").replace(/\\s+/g, " ").slice(0, 80),
            phase: (list?.innerHTML ?? "").includes("session-skeleton")
              ? "skeleton"
              : (list?.innerHTML ?? "").includes("session-loading")
                ? "loading/empty"
                : list?.childElementCount
                  ? "content"
                  : "empty",
            errors: (window.__qaErrors ?? []).slice(0, 3),
            console: (window.__qaConsole ?? []).slice(0, 5),
            getElementCalls: (window.__qaGetElementCalls ?? []).length,
            getElementDetail: (window.__qaGetElementCalls ?? []).slice(0, 3),
            mutations: (window.__qaSidebarMutations ?? []).slice(0, 6),
            picotNative: typeof window.__picotNative === "object",
            picotConfigCall: typeof window.__picotConfigCall === "function",
          };
        })()`,
        returnByValue: true,
      });
      samples.push({
        t: second + 1,
        ...(evaluated?.result?.value ?? {}),
      });
    }
    cdp.close();
    console.log(JSON.stringify({ samples }, null, 2));
  } finally {
    chrome.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
