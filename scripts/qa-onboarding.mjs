// First-run / entry-point sweep: every core app must render its primary
// create/action entry point in both viewports without JS errors or
// horizontal overflow. This guards the "each app has a visible way to start"
// usability requirement without depending on workspace contents.
//
// Usage (app must be running on localhost):
//   node scripts/qa-onboarding.mjs <workspaceId|folderName> [sessionId]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 12000);

// App id -> regexes that must appear in the rendered page text.
const APP_CHECKS = {
  notes: [/New notebook|新建笔记本|Your local Markdown library|你的本地 Markdown 笔记库/],
  tasks: [/New task|新建任务|Task center|任务中心/],
  automation: [/New automation|新建自动化|Automation center|自动化中心/],
  projects: [/Manage projects|管理项目|Project overview|项目工作区/],
  clipboard: [/Add to inbox|添加到收件箱|Paste from clipboard|从剪贴板粘贴/],
  articles: [/New article|新建文章|Article publishing|文章创作/],
};

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveWorkspaceId(host, projectPath) {
  try {
    const response = await fetch(`${host}/v2/resolve-workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.workspaceId === "string" ? body.workspaceId : null;
  } catch {
    return null;
  }
}

async function discoverSessionId(host, workspaceId) {
  try {
    const response = await fetch(
      `${host}/v2/sessions?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    if (!response.ok) return null;
    const body = await response.json();
    const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
    if (sessions.length === 0) return null;
    const current = sessions.find((session) => session.isCurrentWorkspace);
    const sorted = [...sessions].sort(
      (left, right) =>
        (Number(right.modifiedAtMs) || 0) - (Number(left.modifiedAtMs) || 0),
    );
    return (current ?? sorted[0])?.id ?? null;
  } catch {
    return null;
  }
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
          const { res, rej } = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) rej(new Error(message.error.message));
          else res(message);
        }
      });
      resolve({ send, close: () => ws.close() });
    });
    ws.addEventListener("error", reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.result?.exceptionDetails) {
    throw new Error(
      result.result.exceptionDetails.exception?.description ??
        result.result.exceptionDetails.text,
    );
  }
  return result.result?.result?.value;
}

async function checkApp(cdp, appId, url, viewport) {
  await cdp.send("Page.navigate", { url });
  await sleep(WAIT_MS);
  const state = await evaluate(
    cdp,
    `(() => {
      const doc = document.documentElement;
      return {
        activePluginId: document.body.dataset.activePlugin ?? null,
        startupFailure: Boolean(document.querySelector(".startup-failure-surface")),
        bodyText: document.body.innerText.replace(/\\s+/g, " ").slice(0, 600),
        overflowX: doc.scrollWidth > doc.clientWidth,
        errors: window.__qaOnboardingErrors ?? [],
      };
    })()`,
  );
  const patterns = APP_CHECKS[appId] ?? [];
  const matched = patterns.some((pattern) => pattern.test(state.bodyText));
  const failures = [];
  if (!matched) failures.push(`entry-point text not found in body`);
  if (state.overflowX) failures.push("horizontal overflow");
  if (state.startupFailure) failures.push("startup failure surface shown");
  if (state.errors.length > 0) failures.push(`console errors: ${state.errors.join(" | ")}`);
  const result = {
    app: appId,
    viewport: `${viewport.width}x${viewport.height}`,
    activePluginId: state.activePluginId,
    matched,
    overflowX: state.overflowX,
    failures,
    pass: failures.length === 0,
  };
  console.log("ONBOARDING:", JSON.stringify(result));
  return result;
}

async function main() {
  const rawWs = process.argv[2] || process.env.ZICODE_WORKSPACE;
  let sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!rawWs) {
    console.error(
      "Usage: node scripts/qa-onboarding.mjs <workspaceId> <sessionId>",
    );
    process.exit(2);
  }
  let workspaceId = rawWs;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawWs)) {
    const candidates = [rawWs];
    const workspacesRoot = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "zicode", "workspaces")
      : null;
    if (workspacesRoot && !/[\\/]/.test(rawWs)) {
      candidates.push(join(workspacesRoot, rawWs));
    }
    for (const candidate of candidates) {
      const resolved = await resolveWorkspaceId(HOST, candidate);
      if (resolved) {
        workspaceId = resolved;
        break;
      }
    }
    if (workspaceId === rawWs) {
      console.error(`Could not resolve workspace from "${rawWs}"`);
      process.exit(2);
    }
    console.log(`[qa-onboarding] resolved workspace ${rawWs} -> ${workspaceId}`);
  }
  if (!sessionId) {
    sessionId = await discoverSessionId(HOST, workspaceId);
  }
  if (!sessionId) {
    console.error("Could not discover a session for this workspace");
    process.exit(2);
  }

  const profile = mkdtempSync(join(tmpdir(), "zicode-onboarding-"));
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
      await sleep(300);
      if (!debugPort) {
        try {
          debugPort = readFileSync(
            join(profile, "DevToolsActivePort"),
            "utf8",
          )
            .trim()
            .split("\n")[0];
        } catch {
          // Not ready yet.
        }
      }
      if (!debugPort) continue;
      try {
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(
          (response) => response.json(),
        );
        target = targets.find((candidate) => candidate.type === "page");
      } catch {
        // Not ready yet.
      }
    }
    if (!target) throw new Error("Could not discover a Chrome page target");

    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__qaOnboardingErrors = [];
        const originalError = console.error.bind(console);
        console.error = (...args) => {
          window.__qaOnboardingErrors.push(args.map(String).join(" ").slice(0, 200));
          originalError(...args);
        };
        window.addEventListener("error", (event) => {
          window.__qaOnboardingErrors.push(
            "uncaught: " + (event.message || String(event.error)).slice(0, 200),
          );
        });
      })()`,
    });

    const sessionUrl = `${HOST}/app/workspaces/${workspaceId}/sessions/${sessionId}`;
    const allResults = [];
    for (const appId of Object.keys(APP_CHECKS)) {
      for (const viewport of VIEWPORTS) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.width < 768,
        });
        allResults.push(
          await checkApp(
            cdp,
            appId,
            `${sessionUrl}?app=com.zicode.${appId}`,
            viewport,
          ),
        );
      }
    }

    const failures = allResults.filter((result) => !result.pass);
    if (failures.length > 0) {
      console.error(
        `ONBOARDING SWEEP FAILED: ${failures.length}/${allResults.length} view(s)`,
      );
      process.exitCode = 1;
    } else {
      console.log(`ONBOARDING SWEEP: ${allResults.length}/${allResults.length} entry points clean`);
    }
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
