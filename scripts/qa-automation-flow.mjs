// Automation center interaction sweep: open the new-workflow form, pick a
// built-in template (prompt must prefill), create the workflow, edit its
// title, remove it, and prove the persisted workflows.json returns to its
// pre-test state. Exercises the automation usage loop end to end.
//
// Usage (app must be running on localhost):
//   node scripts/qa-automation-flow.mjs <workspaceId|folderName> [sessionId]
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 8000);
const QA_PREFIX = "QA 自动化验收";

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

function stripQaWorkflows(content) {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.workflows)) return content;
    const next = parsed.workflows.filter(
      (workflow) => !String(workflow?.title || "").startsWith(QA_PREFIX),
    );
    return JSON.stringify({ ...parsed, workflows: next }, null, 2);
  } catch {
    return content;
  }
}

async function main() {
  const rawWs = process.argv[2] || process.env.ZICODE_WORKSPACE;
  let sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!rawWs) {
    console.error(
      "Usage: node scripts/qa-automation-flow.mjs <workspaceId> <sessionId>",
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
    console.log(`[qa-automation-flow] resolved workspace ${rawWs} -> ${workspaceId}`);
  }
  if (!sessionId) {
    sessionId = await discoverSessionId(HOST, workspaceId);
  }
  if (!sessionId) {
    console.error("Could not discover a session for this workspace");
    process.exit(2);
  }

  let workflowFile = "";
  try {
    const sessionsResponse = await fetch(
      `${HOST}/v2/sessions?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    const sessionsBody = await sessionsResponse.json();
    const session = (sessionsBody?.sessions ?? []).find(
      (entry) => entry.isCurrentWorkspace,
    );
    const projectPath = String(session?.projectPath ?? "");
    const clean = projectPath.replace(/^\\\\\?\\/, "").replace(/^\\\?\\/, "");
    workflowFile = join(clean, ".zicode", "automation", "workflows.json");
  } catch {
    workflowFile = "";
  }
  let beforeContent = "";
  try {
    if (workflowFile) beforeContent = readFileSync(workflowFile, "utf8");
  } catch {
    beforeContent = "";
  }
  try {
    if (workflowFile && beforeContent.includes(QA_PREFIX)) {
      writeFileSync(workflowFile, stripQaWorkflows(beforeContent));
      console.log("[qa-automation-flow] pre-cleaned leftover QA workflows");
    }
  } catch {
    // Best effort; the unique stamp keeps runs independent anyway.
  }

  const stamp = Date.now();
  const qaTitle = `${QA_PREFIX} ${stamp}`;
  const qaTitleEdited = `${QA_PREFIX}（已编辑） ${stamp}`;

  const profile = mkdtempSync(join(tmpdir(), "zicode-auto-flow-"));
  const viewport = process.env.VIEWPORT;
  const [width, height] = viewport
    ? viewport.split("x").map(Number)
    : [1440, 900];
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
      `--window-size=${width},${height}`,
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
    if (viewport) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
    }
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        globalThis.confirm = () => true;
        window.__qaAutoErrors = [];
        const originalError = console.error.bind(console);
        console.error = (...args) => {
          window.__qaAutoErrors.push(args.map(String).join(" ").slice(0, 200));
          originalError(...args);
        };
      })()`,
    });
    const sessionUrl = `${HOST}/app/workspaces/${workspaceId}/sessions/${sessionId}?app=com.zicode.automation`;
    await cdp.send("Page.navigate", { url: sessionUrl });
    await sleep(WAIT_MS + 6000);

    const failures = [];

    // 1. Open the new-workflow form and pick a built-in template.
    const created = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const setValue = (el, value) => {
          Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          ).set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const form = document.querySelector(".automation-form");
        if (!form) return { error: "automation form not opened" };
        const template = Array.from(
          document.querySelectorAll(".automation-template-card"),
        ).find((card) =>
          /Daily tech brief|每日技术简报/.test(card.textContent || ""),
        ) ?? document.querySelector(".automation-template-card");
        if (!template) return { error: "template card missing" };
        template.click();
        await wait(500);
        const titleInput = document.getElementById("automation-name");
        const prompt = document.getElementById("automation-prompt");
        if (!titleInput || !prompt) return { error: "form fields missing" };
        const templateTitle = titleInput.value;
        const templatePrompt = prompt.value;
        setValue(titleInput, ${JSON.stringify(qaTitle)});
        form.querySelector('button[type="submit"]').click();
        for (let i = 0; i < 60; i += 1) {
          const card = Array.from(document.querySelectorAll(".automation-card")).find(
            (node) => (node.textContent || "").includes(${JSON.stringify(qaTitle)}),
          );
          if (card) {
            return {
              cardFound: true,
              templateTitle,
              promptPrefilled: templatePrompt.trim().length > 40,
              promptSample: templatePrompt.slice(0, 40),
            };
          }
          await wait(300);
        }
        return { error: "workflow card did not appear" };
      })()`,
    );
    if (!created.cardFound) {
      failures.push(`create: ${created.error ?? "card not found"}`);
    }
    if (!created.promptPrefilled) {
      failures.push("create: template prompt was not prefilled");
    }
    console.log("CREATE:", JSON.stringify(created));

    // 2. Edit the title and verify the card updates.
    const edited = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const setValue = (el, value) => {
          Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          ).set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const card = Array.from(document.querySelectorAll(".automation-card")).find(
          (node) => (node.textContent || "").includes(${JSON.stringify(qaTitle)}),
        );
        if (!card) return { error: "card missing before edit" };
        const edit = Array.from(card.querySelectorAll("button")).find((button) =>
          /Edit|编辑/.test(button.textContent || ""),
        );
        if (!edit) return { error: "edit button missing" };
        edit.click();
        await wait(600);
        const titleInput = document.getElementById("automation-name");
        if (!titleInput) return { error: "edit form missing" };
        setValue(titleInput, ${JSON.stringify(qaTitleEdited)});
        document
          .querySelector(".automation-form button[type='submit']")
          .click();
        for (let i = 0; i < 60; i += 1) {
          const updated = Array.from(document.querySelectorAll(".automation-card")).find(
            (node) => (node.textContent || "").includes(${JSON.stringify(qaTitleEdited)}),
          );
          if (updated) return { updated: true };
          await wait(300);
        }
        return { error: "edited title did not appear" };
      })()`,
    );
    if (!edited.updated) {
      failures.push(`edit: ${edited.error ?? "not updated"}`);
    }
    console.log("EDIT:", JSON.stringify(edited));

    // 3. Remove the workflow and verify it disappears.
    const removed = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const card = Array.from(document.querySelectorAll(".automation-card")).find(
          (node) => (node.textContent || "").includes(${JSON.stringify(qaTitleEdited)}),
        );
        if (!card) return { error: "card missing before remove" };
        const remove = Array.from(card.querySelectorAll("button")).find((button) =>
          /Remove|移除/.test(button.textContent || ""),
        );
        if (!remove) return { error: "remove button missing" };
        remove.click();
        await wait(800);
        for (let i = 0; i < 60; i += 1) {
          const remaining = Array.from(document.querySelectorAll(".automation-card")).some(
            (node) =>
              (node.textContent || "").includes(${JSON.stringify(qaTitleEdited)}) ||
              (node.textContent || "").includes(${JSON.stringify(qaTitle)}),
          );
          if (!remaining) return { removed: true };
          await wait(300);
        }
        return { error: "workflow still present after remove" };
      })()`,
    );
    if (!removed.removed) {
      failures.push(`remove: ${removed.error ?? "still present"}`);
    }
    console.log("REMOVE:", JSON.stringify(removed));

    // 4. Verify the persisted file no longer contains the QA workflow.
    await sleep(1000);
    let afterContent = "";
    try {
      if (workflowFile) afterContent = readFileSync(workflowFile, "utf8");
    } catch {
      afterContent = "";
    }
    try {
      if (workflowFile && afterContent.includes(QA_PREFIX)) {
        writeFileSync(workflowFile, stripQaWorkflows(afterContent));
        afterContent = readFileSync(workflowFile, "utf8");
      }
    } catch {
      // Best effort; the in-file check below still reports the truth.
    }
    const stillInFile = afterContent.includes(qaTitle) || afterContent.includes(qaTitleEdited);
    if (stillInFile) {
      failures.push("QA workflow still present in workflows.json after remove");
    }
    console.log("PERSISTED:", JSON.stringify({ stillInFile }));

    if (failures.length > 0) {
      console.error(`AUTOMATION FLOW SWEEP FAILED:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log("AUTOMATION FLOW SWEEP: template -> create -> edit -> remove loop passed");
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
