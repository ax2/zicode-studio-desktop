// Workspace recycle-bin UI sweep: verifies the switcher's trash section
// renders with the correct controls and that "permanent delete" and "empty
// trash" fire the right Tauri commands and refresh the menu.
//
// The recycle-bin actions are desktop-Tauri-only, so the sweep injects a mock
// `__TAURI__.core.invoke` into the page (before app scripts run) and checks
// the command arguments the UI sends. The actual filesystem semantics are
// covered by Rust unit tests.
//
// Usage (app must be running on localhost):
//   node scripts/qa-workspace-trash-ui.mjs <workspaceId> <sessionId>
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
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const messageId = ++id;
            pending.set(messageId, { res, rej });
            ws.send(JSON.stringify({ id: messageId, method, params }));
          });
        },
        close: () => ws.close(),
      });
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rej(new Error(message.error.message));
        else res(message);
      }
      onEvent?.(message);
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
  const workspaceId = process.argv[2] || process.env.ZICODE_WORKSPACE;
  const sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!workspaceId || !sessionId) {
    console.error(
      "Usage: node scripts/qa-workspace-trash-ui.mjs <workspaceId> <sessionId>",
    );
    process.exit(2);
  }

  const profile = mkdtempSync(join(tmpdir(), "zicode-trash-ui-"));
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

  const trashEntry = {
    dir: "C:\\qa-trash\\project-one",
    name: "project-one",
    original_root: "C:\\work\\project-one",
    deleted_at: 1787460714,
  };

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
        window.__qaTrashInvokeCalls = calls;
        let trash = [${JSON.stringify(trashEntry)}];
        window.__qaSetTrash = (entries) => { trash = entries; };
        globalThis.confirm = () => true;
        globalThis.__TAURI__ = { core: { invoke: async (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === "list_workspaces") {
            return [{ id: "ws-global", path: "C:\\\\Users\\\\ax2\\\\.zicode" }];
          }
          if (cmd === "list_workspace_trash") return trash;
          if (cmd === "delete_workspace_trash_entry") {
            trash = trash.filter((entry) => entry.dir !== args.trashDir);
            return undefined;
          }
          if (cmd === "empty_workspace_trash") {
            const count = trash.length;
            trash = [];
            return count;
          }
          return undefined;
        } } };
      })()`,
    });
    const sessionUrl = `${HOST}/app/workspaces/${workspaceId}/sessions/${sessionId}`;
    await cdp.send("Page.navigate", { url: sessionUrl });
    await sleep(WAIT_MS + 10000);

    const render = await evaluate(
      cdp,
      `(async () => {
        const btn = document.getElementById("workspace-switcher-btn");
        if (!btn) return { error: "no switcher button" };
        btn.click();
        for (let i = 0; i < 60; i += 1) {
          if (document.querySelector(".workspace-switcher-trash-heading")) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const heading = document.querySelector(".workspace-switcher-trash-heading");
        const emptyBtn = document.querySelector(".workspace-switcher-empty-trash");
        const row = document.querySelector(".workspace-switcher-trash-row");
        const restore = document.querySelector(".workspace-switcher-restore");
        const del = document.querySelector(".workspace-switcher-trash-delete");
        const expiry = document.querySelector(".workspace-switcher-trash-expiry");
        const style = (el) => (el ? getComputedStyle(el) : null);
        return {
          headingText: heading?.textContent ?? null,
          headingDisplay: style(heading)?.display ?? null,
          emptyBtnText: emptyBtn?.textContent ?? null,
          emptyBtnDisplay: style(emptyBtn)?.display ?? null,
          rowGrid: style(row)?.gridTemplateColumns ?? null,
          rowText: row?.innerText ?? null,
          restoreText: restore?.textContent ?? null,
          restoreColor: style(restore)?.color ?? null,
          delAria: del?.getAttribute("aria-label") ?? null,
          delDisplay: style(del)?.display ?? null,
          delColor: style(del)?.color ?? null,
          expiryText: expiry?.textContent ?? null,
          invokes: window.__qaTrashInvokeCalls,
        };
      })()`,
    );
    console.log("RENDER:", JSON.stringify(render));

    const del = await evaluate(
      cdp,
      `(async () => {
        const button = document.querySelector(".workspace-switcher-trash-delete");
        if (!button) return { error: "no delete button" };
        button.click();
        for (let i = 0; i < 60; i += 1) {
          if (
            window.__qaTrashInvokeCalls.some(
              (call) => call.cmd === "delete_workspace_trash_entry",
            )
          ) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const call = window.__qaTrashInvokeCalls.find(
          (entry) => entry.cmd === "delete_workspace_trash_entry",
        ) ?? null;
        for (let i = 0; i < 60; i += 1) {
          const menuOpen = !document
            .getElementById("workspace-switcher-menu")
            .classList.contains("hidden");
          if (menuOpen && !document.querySelector(".workspace-switcher-trash-heading")) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return {
          call,
          headingAfterDelete:
            document.querySelector(".workspace-switcher-trash-heading")?.textContent ??
            null,
        };
      })()`,
    );
    console.log("DELETE:", JSON.stringify(del));

    const empty = await evaluate(
      cdp,
      `(async () => {
        window.__qaSetTrash([
          ${JSON.stringify(trashEntry)},
          {
            dir: "C:\\\\qa-trash\\\\project-two",
            name: "project-two",
            original_root: "C:\\\\work\\\\project-two",
            deleted_at: 1787460800,
          },
        ]);
        const btn = document.getElementById("workspace-switcher-btn");
        const menu = document.getElementById("workspace-switcher-menu");
        if (!menu.classList.contains("hidden")) {
          btn.click();
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        btn.click();
        for (let i = 0; i < 60; i += 1) {
          if (document.querySelectorAll(".workspace-switcher-trash-row").length === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const rowsBefore = document.querySelectorAll(".workspace-switcher-trash-row").length;
        document.querySelector(".workspace-switcher-empty-trash").click();
        for (let i = 0; i < 60; i += 1) {
          if (
            window.__qaTrashInvokeCalls.some(
              (call) => call.cmd === "empty_workspace_trash",
            )
          ) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const call = window.__qaTrashInvokeCalls.find(
          (entry) => entry.cmd === "empty_workspace_trash",
        ) ?? null;
        for (let i = 0; i < 60; i += 1) {
          if (!document.querySelector(".workspace-switcher-trash-heading")) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return {
          rowsBefore,
          call,
          headingAfterEmpty:
            document.querySelector(".workspace-switcher-trash-heading")?.textContent ??
            null,
        };
      })()`,
    );
    console.log("EMPTY:", JSON.stringify(empty));

    const failures = [];
    if (
      !render.headingText ||
      !/Recycle bin|回收站/.test(render.headingText) ||
      !/Kept for 30 days|保留 30 天/.test(render.headingText ?? "")
    ) {
      failures.push("recycle-bin heading missing retention text");
    }
    if (render.headingDisplay !== "flex") {
      failures.push("trash heading is not flex (CSS bundle missing)");
    }
    if (render.emptyBtnDisplay !== "inline-flex" && render.emptyBtnDisplay !== "flex") {
      failures.push("empty-trash button not styled");
    }
    if (!/^\S+ \S+ \S+$/.test(render.rowGrid ?? "")) {
      failures.push(`unexpected trash row grid: ${render.rowGrid}`);
    }
    if (render.delDisplay !== "flex") {
      failures.push("trash delete button not styled");
    }
    if (!/Auto-purges in \d+ days|天后自动清除/.test(render.expiryText ?? "")) {
      failures.push("trash row missing auto-purge countdown");
    }
    if (del.call?.cmd !== "delete_workspace_trash_entry") {
      failures.push("permanent delete did not invoke delete_workspace_trash_entry");
    }
    if (del.call?.args?.trashDir !== trashEntry.dir) {
      failures.push("permanent delete sent wrong trashDir");
    }
    if (del.headingAfterDelete !== null) {
      failures.push("recycle bin section did not disappear after delete");
    }
    if (empty.rowsBefore !== 2) {
      failures.push("empty-trash test did not render two rows");
    }
    if (empty.call?.cmd !== "empty_workspace_trash") {
      failures.push("empty trash did not invoke empty_workspace_trash");
    }
    if (empty.headingAfterEmpty !== null) {
      failures.push("recycle bin section did not disappear after empty");
    }

    if (failures.length > 0) {
      console.error(`TRASH UI SWEEP FAILED:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log("TRASH UI SWEEP: recycle bin render/delete/empty all passed");
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
