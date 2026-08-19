// Data-presence sweep across data-driven app views.
//
// Catches the "app opens but shows an empty list while the backend has
// data" class of regression (e.g. the Articles list was empty on first open
// even though the API returned 456 posts). Each view is loaded in a fresh
// profile, then the rendered item count is cross-checked against the host
// API count where the endpoint is known.
//
// Usage (app must be running on localhost):
//   node scripts/qa-data-presence.mjs <workspaceId> <sessionId>
//   APP_FILTER=articles node scripts/qa-data-presence.mjs <ws> <session>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 7000);

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

async function apiCount(path) {
  try {
    const response = await fetch(`${HOST}${path}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const VIEWS = [
  {
    name: "articles",
    url: (sessionUrl) => `${sessionUrl}?app=com.zicode.articles`,
    api: async (wsId) => {
      const body = await apiCount(
        `/v2/articles?sceneId=programming&workspaceId=${wsId}`,
      );
      return Array.isArray(body?.articles) ? body.articles.length : null;
    },
    uiSelector: ".articles-item",
    check: (uiCount, apiCount) => ({
      pass: apiCount === null || uiCount === apiCount,
      detail: `UI ${uiCount} vs API ${apiCount ?? "n/a"}`,
    }),
  },
  {
    name: "notes",
    url: (sessionUrl) => `${sessionUrl}?app=com.zicode.notes`,
    api: async (wsId) => {
      const body = await apiCount(
        `/v2/notes?sceneId=programming&workspaceId=${wsId}`,
      );
      return body?.snapshot ? body.snapshot.notebooks?.length ?? null : null;
    },
    uiSelector: ".notes-notebook-branch, .notes-list-item, .notes-result-item, .notes-nav-item",
    check: (uiCount, apiCount) => ({
      pass:
        apiCount === null
          ? uiCount > 0
          : apiCount === 0
            ? true
            : uiCount >= Math.min(apiCount, 5),
      detail: `UI ${uiCount} vs API ${apiCount ?? "n/a"}`,
    }),
  },
  {
    name: "artifacts",
    url: (sessionUrl) => `${sessionUrl}?app=com.zicode.artifacts`,
    api: async (wsId) => {
      const body = await apiCount(
        `/v2/artifacts?sceneId=programming&workspaceId=${wsId}`,
      );
      return body?.snapshot ? body.snapshot.artifacts?.length ?? null : null;
    },
    uiSelector: ".artifact-item, .artifact-row, .artifact-list li",
    check: (uiCount, apiCount) => ({
      pass:
        apiCount === null
          ? true
          : apiCount === 0
            ? uiCount === 0
            : uiCount >= Math.min(apiCount, 10),
      detail: `UI ${uiCount} vs API ${apiCount ?? "n/a"}`,
    }),
  },
  {
    name: "tasks",
    url: (sessionUrl) => `${sessionUrl}?app=com.zicode.tasks`,
    api: async (wsId) => {
      const body = await apiCount(
        `/v2/tasks?sceneId=programming&workspaceId=${wsId}`,
      );
      return Array.isArray(body) ? body.length : Array.isArray(body?.tasks) ? body.tasks.length : null;
    },
    uiSelector: ".task-center-card",
    check: (uiCount, apiCount) => ({
      pass:
        apiCount === null
          ? true
          : apiCount === 0
            ? uiCount === 0
            : uiCount >= Math.min(apiCount, 10),
      detail: `UI ${uiCount} vs API ${apiCount ?? "n/a"}`,
    }),
  },
  {
    name: "finance",
    url: (sessionUrl) => `${sessionUrl}?app=com.zicode.finance`,
    api: async () => null,
    uiSelector: "form, .research-form, textarea, input, .scene-guard",
    check: (uiCount) => ({
      pass: uiCount > 0,
      detail: `interactive/guard elements ${uiCount}`,
    }),
  },
];

async function main() {
  const wsId = process.argv[2] || process.env.ZICODE_WORKSPACE;
  const sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!wsId || !sessionId) {
    throw new Error(
      "Usage: node scripts/qa-data-presence.mjs <workspaceId> <sessionId>",
    );
  }
  const filter = process.env.APP_FILTER;
  const sessionUrl = `${HOST}/app/workspaces/${wsId}/sessions/${sessionId}`;
  const views = VIEWS.filter((view) => !filter || view.name === filter);

  const profile = mkdtempSync(join(tmpdir(), "zicode-data-"));
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

    const report = [];
    for (const view of views) {
      const expected = await view.api(wsId);
      await cdp.send("Page.navigate", { url: view.url(sessionUrl) });
      await sleep(WAIT_MS);
      const result = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const startupFailed = document.body?.classList.contains("startup-failed") ?? false;
          const count = document.querySelectorAll(${JSON.stringify(view.uiSelector)}).length;
          const mainText = (document.querySelector(".plugin-main-view")?.textContent ?? "")
            .replace(/\\s+/g, " ").trim().slice(0, 80);
          return { startupFailed, count, mainText };
        })()`,
        returnByValue: true,
      });
      const state = result?.result?.value ?? {
        startupFailed: false,
        count: 0,
        mainText: "",
      };
      const verdict = view.check(state.count, expected);
      const pass = !state.startupFailed && verdict.pass;
      report.push({ name: view.name, ...state, expected, verdict, pass });
      console.log(
        JSON.stringify({
          name: view.name,
          startupFailed: state.startupFailed,
          items: state.count,
          expected,
          verdict: verdict.detail,
          pass,
        }),
      );
    }

    const failures = report.filter((entry) => !entry.pass);
    console.log(
      `DATA PRESENCE: ${report.length - failures.length}/${report.length} views pass` +
        (failures.length > 0
          ? ` (${failures.map((entry) => entry.name).join(", ")} failed)`
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
