#!/usr/bin/env node
// Welcome-screen starter templates: real closed loop on the running app.
//
// Creates a fresh temporary session via the host API (the same path LAN/remote
// clients use), verifies the welcome renders the template grid (desktop) and
// hides it on mobile, clicks a template and asserts the composer is prefilled
// with the localized prompt, then asserts the temporary session is not listed
// in the sidebar — temporary sessions are host-ephemeral and never enter the
// session list, so no QA residue reaches the user's conversation list.
//
// Usage (app must be running on localhost):
//   node scripts/qa-chat-templates.mjs <workspaceId|folderName>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 12000);

const EXPECTED_TEMPLATES = [
  { id: "write-blog", label: "写技术博客" },
  { id: "translate", label: "翻译文本" },
  { id: "organize-notes", label: "整理成笔记" },
  { id: "review-code", label: "审查代码" },
  { id: "brainstorm", label: "头脑风暴" },
  { id: "analyze", label: "分析数据" },
];

// The Agent Inbox workspace renders a specialized welcome without the starter
// template grid. qa:full defaults to agent-inbox, so the sweep falls back to
// the global workspace (~/.zicode) when the inbox workspace is selected.
const INBOX_WORKSPACE_IDS = new Set([
  "485d7fce-61a4-449f-91e2-6c6d1bbb78da",
]);

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

async function createSession(host, workspaceId) {
  const response = await fetch(`${host}/v2/new-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId, sceneId: "programming" }),
  });
  if (!response.ok) {
    throw new Error(`/v2/new-session failed with ${response.status}`);
  }
  const target = await response.json();
  if (!target?.workspaceId || !target?.sessionId) {
    throw new Error("Server returned an invalid session target");
  }
  return target;
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

async function waitFor(cdp, expression, attempts = 50, delayMs = 300) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await evaluate(cdp, expression);
    if (value) return value;
    await sleep(delayMs);
  }
  return null;
}

async function checkWelcome(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 768,
  });
  const ready = await waitFor(
    cdp,
    `Boolean(document.querySelector(".welcome-template"))`,
    90,
  );
  if (!ready) {
    throw new Error("Welcome screen did not render starter templates");
  }
  const state = await evaluate(
    cdp,
    `(() => {
      const doc = document.documentElement;
      const heading = document.querySelector(".welcome-templates-heading");
      const buttons = Array.from(
        document.querySelectorAll(".welcome-template"),
      ).map((button) => ({
        id: button.getAttribute("data-template-id"),
        label:
          button
            .querySelector(".welcome-template-icon")
            ?.nextElementSibling?.textContent?.replace(/\\s+/g, " ")
            .trim() ?? "",
      }));
      const container = document.querySelector(".welcome-templates");
      return {
        heading: heading?.textContent?.trim() ?? null,
        count: buttons.length,
        buttons,
        visible: container
          ? getComputedStyle(container).display !== "none"
          : false,
        overflowX: doc.scrollWidth > doc.clientWidth,
        startupFailure: Boolean(document.querySelector(".startup-failure-surface")),
        errors: window.__qaChatTemplateErrors ?? [],
      };
    })()`,
  );
  const failures = [];
  if (state.heading !== "从模板开始") {
    failures.push(`heading mismatch: ${state.heading}`);
  }
  if (state.count !== EXPECTED_TEMPLATES.length) {
    failures.push(`expected ${EXPECTED_TEMPLATES.length} templates, got ${state.count}`);
  }
  for (const expected of EXPECTED_TEMPLATES) {
    const found = state.buttons.find((button) => button.id === expected.id);
    if (!found) {
      failures.push(`missing template ${expected.id}`);
    } else if (found.label !== expected.label) {
      failures.push(`template ${expected.id} label mismatch: ${found.label}`);
    }
  }
  if (viewport.width >= 768 && !state.visible) {
    failures.push("template grid hidden on desktop");
  }
  if (viewport.width < 768 && state.visible) {
    failures.push("template grid visible on mobile (should stay hidden)");
  }
  if (state.overflowX) failures.push("horizontal overflow");
  if (state.startupFailure) failures.push("startup failure surface shown");
  if (state.errors.length > 0) {
    failures.push(`console errors: ${state.errors.join(" | ")}`);
  }
  console.log(
    "TEMPLATE-WELCOME:",
    JSON.stringify({
      viewport: `${viewport.width}x${viewport.height}`,
      count: state.count,
      heading: state.heading,
      visible: state.visible,
      failures,
      pass: failures.length === 0,
    }),
  );
  return { failures, state };
}

async function checkPrefill(cdp) {
  await evaluate(
    cdp,
    `document.querySelector('[data-template-id="write-blog"]')?.click()`,
  );
  await sleep(500);
  const first = await evaluate(
    cdp,
    `(() => {
      const input = document.getElementById("message-input");
      return input?.value ?? "";
    })()`,
  );
  const failures = [];
  if (!first.includes("技术博客") || !first.includes("结构清晰")) {
    failures.push(`write-blog prefill mismatch: ${first.slice(0, 80)}`);
  }
  await evaluate(
    cdp,
    `document.querySelector('[data-template-id="translate"]')?.click()`,
  );
  await sleep(500);
  const second = await evaluate(
    cdp,
    `(() => {
      const input = document.getElementById("message-input");
      return input?.value ?? "";
    })()`,
  );
  if (!second.includes("翻译") || !second.includes("保留原意")) {
    failures.push(`translate prefill mismatch: ${second.slice(0, 80)}`);
  }
  console.log(
    "TEMPLATE-PREFILL:",
    JSON.stringify({ failures, pass: failures.length === 0 }),
  );
  return failures;
}

async function checkNoResidue(cdp, sessionId) {
  const failures = [];
  try {
    const listed = await evaluate(
      cdp,
      `Boolean(document.querySelector('[data-session-id="${sessionId}"]'))`,
    );
    if (listed) {
      failures.push("temporary session leaked into the sidebar list");
    }
  } catch (error) {
    failures.push(`residue check threw: ${String(error)}`);
  }
  console.log(
    "TEMPLATE-RESIDUE:",
    JSON.stringify({ sessionId, failures, pass: failures.length === 0 }),
  );
  return failures;
}

async function main() {
  const rawWs = process.argv[2] || process.env.ZICODE_WORKSPACE;
  if (!rawWs) {
    console.error(
      "Usage: node scripts/qa-chat-templates.mjs <workspaceId|folderName>",
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
    console.log(`[qa-chat-templates] resolved workspace ${rawWs} -> ${workspaceId}`);
  }

  let targetWorkspaceId = workspaceId;
  if (
    INBOX_WORKSPACE_IDS.has(workspaceId) ||
    /agent-inbox$/i.test(String(rawWs).replace(/[\\/]+$/, ""))
  ) {
    const globalWorkspace = join(homedir(), ".zicode");
    const resolved = await resolveWorkspaceId(HOST, globalWorkspace);
    if (!resolved) {
      console.error(
        `Could not resolve the global workspace at ${globalWorkspace}`,
      );
      process.exit(2);
    }
    console.log(
      `[qa-chat-templates] agent-inbox has a specialized welcome; using global workspace ${resolved}`,
    );
    targetWorkspaceId = resolved;
  }

  const target = await createSession(HOST, targetWorkspaceId);
  console.log(
    `[qa-chat-templates] created throwaway session ${target.sessionId}`,
  );

  const profile = mkdtempSync(join(tmpdir(), "zicode-chat-templates-"));
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
    let cdpTarget = null;
    for (let attempt = 0; attempt < 80 && !cdpTarget; attempt += 1) {
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
        cdpTarget = targets.find((candidate) => candidate.type === "page");
      } catch {
        // Not ready yet.
      }
    }
    if (!cdpTarget) throw new Error("Could not discover a Chrome page target");

    const cdp = await connect(cdpTarget.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__qaChatTemplateErrors = [];
        const originalError = console.error.bind(console);
        console.error = (...args) => {
          window.__qaChatTemplateErrors.push(args.map(String).join(" ").slice(0, 200));
          originalError(...args);
        };
        window.addEventListener("error", (event) => {
          window.__qaChatTemplateErrors.push(
            "uncaught: " + (event.message || String(event.error)).slice(0, 200),
          );
        });
      })()`,
    });

    const sessionUrl = `${HOST}/app/workspaces/${targetWorkspaceId}/sessions/${target.sessionId}`;
    await cdp.send("Page.navigate", { url: sessionUrl });
    await sleep(WAIT_MS);

    const failures = [];
    const desktop = await checkWelcome(cdp, { width: 1440, height: 900 });
    failures.push(...desktop.failures);
    failures.push(...(await checkPrefill(cdp)));
    const mobile = await checkWelcome(cdp, { width: 390, height: 844 });
    failures.push(...mobile.failures);
    failures.push(...(await checkNoResidue(cdp, target.sessionId)));

    cdp.close();
    if (failures.length > 0) {
      console.error(
        `CHAT TEMPLATES SWEEP FAILED: ${failures.length} issue(s)`,
      );
      for (const failure of failures) console.error("- " + failure);
      process.exitCode = 1;
    } else {
      console.log(
        "CHAT TEMPLATES SWEEP: welcome grid, prefill and no-residue all passed",
      );
    }
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
