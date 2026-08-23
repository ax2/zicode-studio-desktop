// Workspace backup settings sweep: open Settings -> General, create a backup
// through the real UI, verify it appears in the list, delete it, and verify
// the list empties again. The backup commands are desktop-Tauri-only, so the
// sweep injects a mock invoke (the actual snapshot/restore semantics are
// covered by Rust + store unit tests).
//
// Usage (app must be running on localhost):
//   node scripts/qa-backup-flow.mjs <workspaceId|folderName> [sessionId]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    console.error("Usage: node scripts/qa-backup-flow.mjs <workspaceId> <sessionId>");
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
    console.log(`[qa-backup-flow] resolved workspace ${rawWs} -> ${workspaceId}`);
  }
  if (!sessionId) {
    sessionId = await discoverSessionId(HOST, workspaceId);
  }
  if (!sessionId) {
    console.error("Could not discover a session for this workspace");
    process.exit(2);
  }

  const profile = mkdtempSync(join(tmpdir(), "zicode-backup-flow-"));
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
        const calls = [];
        window.__qaBackupCalls = calls;
        let backups = [];
        globalThis.confirm = () => true;
        globalThis.__TAURI__ = { core: { invoke: async (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === "list_workspace_backups") return backups;
          if (cmd === "create_workspace_backup") {
            const created = {
              id: "qa-backup-" + Date.now(),
              workspaceId: args?.workspaceId ?? "",
              workspaceRoot: "C:\\\\qa\\\\workspace",
              createdAt: new Date().toISOString(),
              sizeBytes: 2048,
              apps: ["notes", "sessions"],
            };
            backups = [created, ...backups];
            return created;
          }
          if (cmd === "delete_workspace_backup") {
            backups = backups.filter((backup) => backup.id !== args?.backupId);
            return undefined;
          }
          if (cmd === "restore_workspace_backup") {
            return { apps: ["notes", "sessions"] };
          }
          return undefined;
        } } };
      })()`,
    });
    const sessionUrl = `${HOST}/app/workspaces/${workspaceId}/sessions/${sessionId}?app=com.zicode.tasks#/settings/general`;
    await cdp.send("Page.navigate", { url: sessionUrl });
    await sleep(WAIT_MS + 6000);

    const failures = [];

    const created = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let i = 0; i < 60; i += 1) {
          if (document.getElementById("workspace-backup-section")) break;
          await wait(300);
        }
        const section = document.getElementById("workspace-backup-section");
        if (!section) return { error: "backup section not found" };
        section.scrollIntoView?.();
        await wait(400);
        const createBtn = document.getElementById("create-workspace-backup");
        if (!createBtn) {
          return { error: "create button missing (backupAvailable false?)" };
        }
        createBtn.click();
        for (let i = 0; i < 60; i += 1) {
          if (
            window.__qaBackupCalls.some(
              (call) => call.cmd === "create_workspace_backup",
            ) &&
            document.querySelectorAll(".workspace-backup-item").length > 0
          ) break;
          await wait(300);
        }
        const items = document.querySelectorAll(".workspace-backup-item").length;
        const status = document.getElementById("workspace-backup-status")?.textContent ?? "";
        return { items, status, calls: window.__qaBackupCalls };
      })()`,
    );
    if (!created.items || created.items < 1) {
      failures.push(`create: backup item did not appear (${created.error ?? created.items})`);
    }
    if (!created.calls?.some((call) => call.cmd === "create_workspace_backup")) {
      failures.push("create: create_workspace_backup not invoked");
    }
    console.log("CREATE:", JSON.stringify(created));

    const restored = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const restore = document.querySelector(
          ".workspace-backup-item .ui-button--secondary",
        );
        if (!restore) return { error: "restore button missing" };
        restore.click();
        for (let i = 0; i < 60; i += 1) {
          const status =
            document.getElementById("workspace-backup-status")?.textContent ?? "";
          if (
            window.__qaBackupCalls.some(
              (call) => call.cmd === "restore_workspace_backup",
            ) &&
            /Workspace restored from backup|已从备份恢复工作区/.test(status)
          ) {
            return { status, calls: window.__qaBackupCalls };
          }
          await wait(300);
        }
        return {
          error: "restore status not shown",
          status:
            document.getElementById("workspace-backup-status")?.textContent ?? "",
          calls: window.__qaBackupCalls,
        };
      })()`,
    );
    if (
      !restored.calls?.some((call) => call.cmd === "restore_workspace_backup")
    ) {
      failures.push("restore: restore_workspace_backup not invoked");
    }
    if (!/Workspace restored from backup|已从备份恢复工作区/.test(restored.status ?? "")) {
      failures.push(`restore: confirmation status missing (${restored.status ?? ""})`);
    }
    console.log("RESTORE:", JSON.stringify(restored));

    const deleted = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const del = document.querySelector(
          ".workspace-backup-item .ui-button--ghost",
        );
        if (!del) return { error: "delete button missing" };
        del.click();
        for (let i = 0; i < 60; i += 1) {
          if (
            window.__qaBackupCalls.some(
              (call) => call.cmd === "delete_workspace_backup",
            ) &&
            document.querySelectorAll(".workspace-backup-item").length === 0
          ) break;
          await wait(300);
        }
        return {
          items: document.querySelectorAll(".workspace-backup-item").length,
          calls: window.__qaBackupCalls,
        };
      })()`,
    );
    if (deleted.items !== 0) {
      failures.push("delete: backup item still present");
    }
    if (!deleted.calls?.some((call) => call.cmd === "delete_workspace_backup")) {
      failures.push("delete: delete_workspace_backup not invoked");
    }
    console.log("DELETE:", JSON.stringify(deleted));

    if (failures.length > 0) {
      console.error(`BACKUP FLOW SWEEP FAILED:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log("BACKUP FLOW SWEEP: create -> list -> restore -> delete loop passed");
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
