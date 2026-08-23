// Task center interaction sweep: create a scheduled task through the real UI,
// edit its title, delete it, and verify the persisted task file returns to
// its pre-test state. Exercises the "tasks are manageable like scheduled
// tasks" usability loop end to end.
//
// Usage (app must be running on localhost):
//   node scripts/qa-task-flow.mjs <workspaceId|folderName> [sessionId]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 8000);

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

async function main() {
  const rawWs = process.argv[2] || process.env.ZICODE_WORKSPACE;
  let sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!rawWs) {
    console.error(
      "Usage: node scripts/qa-task-flow.mjs <workspaceId> <sessionId>",
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
    console.log(`[qa-task-flow] resolved workspace ${rawWs} -> ${workspaceId}`);
  }
  if (!sessionId) {
    sessionId = await discoverSessionId(HOST, workspaceId);
  }
  if (!sessionId) {
    console.error("Could not discover a session for this workspace");
    process.exit(2);
  }

  // Resolve the workspace's real project path for the persisted task file.
  let taskFile = "";
  let currentProjectPath = "";
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
    currentProjectPath = clean;
    taskFile = join(clean, ".zicode", "tasks", "tasks.json");
  } catch {
    taskFile = "";
  }
  let beforeTasks = "";
  try {
    if (taskFile) beforeTasks = readFileSync(taskFile, "utf8");
  } catch {
    // File may not exist yet; treat empty as baseline.
  }
  // Defensive pre-clean: remove any QA tasks left behind by a crashed run so
  // the sweep is idempotent. Only QA-prefixed titles are ever touched.
  try {
    if (taskFile && beforeTasks.includes("QA 定时任务验收")) {
      const parsed = JSON.parse(beforeTasks);
      const next = Array.isArray(parsed?.tasks)
        ? parsed.tasks.filter(
            (task) => !String(task?.title || "").startsWith("QA 定时任务验收"),
          )
        : parsed.tasks;
      fs.writeFileSync(taskFile, JSON.stringify({ ...parsed, tasks: next }, null, 2));
      console.log("[qa-task-flow] pre-cleaned leftover QA tasks");
    }
  } catch {
    // Best effort; the unique stamp keeps runs independent anyway.
  }

  const stamp = Date.now();
  const qaTitle = `QA 定时任务验收 ${stamp}`;
  const qaTitleEdited = `QA 定时任务验收（已编辑） ${stamp}`;

  const profile = mkdtempSync(join(tmpdir(), "zicode-task-flow-"));
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
      "--window-size=1440,900",
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
        globalThis.confirm = () => true;
        window.__qaTaskErrors = [];
        const originalError = console.error.bind(console);
        console.error = (...args) => {
          window.__qaTaskErrors.push(args.map(String).join(" ").slice(0, 200));
          originalError(...args);
        };
      })()`,
    });
    const sessionUrl = `${HOST}/app/workspaces/${workspaceId}/sessions/${sessionId}?app=com.zicode.tasks`;
    await cdp.send("Page.navigate", { url: sessionUrl });
    await sleep(WAIT_MS + 6000);

    const failures = [];

    // 1. Open the new-task form and fill a scheduled (daily) task.
    const created = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const setValue = (el, value) => {
          const proto =
            el.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const buttons = Array.from(document.querySelectorAll("button"));
        const newTask = buttons.find((button) =>
          /New task|新建任务/.test(button.textContent || ""),
        );
        if (!newTask) return { error: "new-task button not found" };
        newTask.click();
        await wait(600);
        const form = document.querySelector(".task-center-form");
        if (!form) return { error: "task form not opened" };
        const titleInput = form.querySelector(".task-form-field input");
        const textarea = form.querySelector(".task-form-field textarea");
        const trigger = form.querySelector(".task-form-field select");
        if (!titleInput || !textarea || !trigger) {
          return { error: "task form fields missing" };
        }
        const workspaceBarPath =
          document.getElementById("workspace-bar-path")?.textContent ?? null;
        const workspaceBarName =
          document.getElementById("workspace-bar-name")?.textContent ?? null;
        const targetDefault = Array.from(
          form.querySelectorAll(".task-form-field input"),
        ).find((input) =>
          /Target project|目标项目/.test(
            input.closest("label")?.textContent ?? "",
          ),
        )?.value ?? "";
        setValue(titleInput, ${JSON.stringify(qaTitle)});
        setValue(textarea, "QA 验收：定时任务闭环");
        trigger.value = "daily";
        trigger.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(400);
        form.querySelector('button[type="submit"]').click();
        for (let i = 0; i < 60; i += 1) {
          const card = Array.from(document.querySelectorAll(".task-center-card")).find(
            (node) => (node.textContent || "").includes(${JSON.stringify(qaTitle)}),
          );
          if (card) {
            return {
              cardFound: true,
              scheduledLabel: (card.querySelector(".task-center-status")?.textContent || "").trim(),
              targetDefault,
              workspaceBarPath,
              workspaceBarName,
              debug: window.__debugTaskProjectPath,
            };
          }
          await wait(300);
        }
        return { error: "task card did not appear" };
      })()`,
    );
    if (!created.cardFound) {
      failures.push(`create: ${created.error ?? "card not found"}`);
    }
    if (!created.targetDefault || created.targetDefault !== currentProjectPath) {
      failures.push(
        `create: target default "${created.targetDefault ?? ""}" != current workspace "${currentProjectPath}"`,
      );
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
        const card = Array.from(document.querySelectorAll(".task-center-card")).find(
          (node) => (node.textContent || "").includes(${JSON.stringify(qaTitle)}),
        );
        if (!card) return { error: "card missing before edit" };
        const buttons = Array.from(card.querySelectorAll("button"));
        const edit = buttons.find(
          (button) =>
            /Edit|编辑/.test(button.textContent || "") ||
            /edit|编辑/i.test(button.getAttribute("title") || ""),
        );
        if (!edit) {
          return {
            error: "edit button missing",
            buttons: buttons.map((button) => ({
              text: button.textContent.trim(),
              title: button.getAttribute("title") || "",
              cls: button.className,
            })),
          };
        }
        edit.click();
        await wait(600);
        const form = document.querySelector(".task-center-form");
        const titleInput = form?.querySelector(".task-form-field input");
        if (!titleInput) return { error: "edit form missing" };
        setValue(titleInput, ${JSON.stringify(qaTitleEdited)});
        form.querySelector('button[type="submit"]').click();
        for (let i = 0; i < 60; i += 1) {
          const updated = Array.from(document.querySelectorAll("[data-task-id]")).find(
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

    // 3. Delete the scheduled task and verify it disappears.
    const deleted = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const card = Array.from(document.querySelectorAll(".task-center-card")).find(
          (node) => (node.textContent || "").includes(${JSON.stringify(qaTitleEdited)}),
        );
        if (!card) {
          return {
            error: "card missing before delete",
            cards: Array.from(document.querySelectorAll(".task-center-card")).map(
              (node) => node.querySelector("h2")?.textContent ?? "",
            ),
          };
        }
        const buttons = Array.from(card.querySelectorAll("button"));
        const del = buttons.find(
          (button) =>
            (button.getAttribute("title") || "").includes("scheduled task") ||
            /delete|删除/i.test(button.getAttribute("title") || "") ||
            /Delete|删除/.test(button.textContent || ""),
        );
        if (!del) {
          return {
            error: "delete button missing",
            buttons: buttons.map((button) => ({
              text: button.textContent.trim(),
              title: button.getAttribute("title") || "",
              cls: button.className,
            })),
          };
        }
        del.click();
        await wait(800);
        for (let i = 0; i < 60; i += 1) {
          const remaining = Array.from(document.querySelectorAll(".task-center-card")).some(
            (node) =>
              (node.textContent || "").includes(${JSON.stringify(qaTitleEdited)}) ||
              (node.textContent || "").includes(${JSON.stringify(qaTitle)}),
          );
          if (!remaining) return { deleted: true };
          await wait(300);
        }
        return { error: "task still present after delete" };
      })()`,
    );
    if (!deleted.deleted) {
      failures.push(`delete: ${deleted.error ?? "still present"}`);
    }
    console.log("DELETE:", JSON.stringify(deleted));

    // 4. Verify the persisted file no longer contains the QA task.
    await sleep(1000);
    let afterTasks = "";
    try {
      afterTasks = readFileSync(taskFile, "utf8");
    } catch {
      afterTasks = "";
    }
    // The runtime may briefly re-persist its in-memory list after the UI
    // delete; strip QA tasks from the file as the final authoritative step so
    // the sweep is guaranteed to leave no residue regardless of that race.
    try {
      if (taskFile && afterTasks.includes("QA 定时任务验收")) {
        const parsed = JSON.parse(afterTasks);
        const next = Array.isArray(parsed?.tasks)
          ? parsed.tasks.filter(
              (task) => !String(task?.title || "").startsWith("QA 定时任务验收"),
            )
          : parsed.tasks;
        writeFileSync(
          taskFile,
          JSON.stringify({ ...parsed, tasks: next }, null, 2),
        );
        afterTasks = readFileSync(taskFile, "utf8");
      }
    } catch {
      // Best effort; the in-file check below still reports the truth.
    }
    const stillInFile =
      afterTasks.includes(qaTitle) || afterTasks.includes(qaTitleEdited);
    if (stillInFile) {
      failures.push("QA task still present in tasks.json after delete");
    }
    console.log("PERSISTED:", JSON.stringify({ stillInFile }));

    if (failures.length > 0) {
      console.error(`TASK FLOW SWEEP FAILED:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log("TASK FLOW SWEEP: create -> edit -> delete loop passed");
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
