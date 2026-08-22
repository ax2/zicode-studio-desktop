// Keyboard reachability sweep across every enabled desktop app view.
//
// Tab-walks each view and reports focus traps, focus landing on invisible
// elements, and broken global shortcuts. The archived/session tree headers
// intentionally use roving tabindex, so arrow navigation is exercised too.
//
// Usage (app must be running on localhost):
//   node scripts/qa-keyboard.mjs <workspaceId|projectPath|folderName> [sessionId]
//   APP_FILTER=notes node scripts/qa-keyboard.mjs <ws> [session]
// Workspace and session are auto-resolved/discovered when omitted or given as
// a folder name, so `node scripts/qa-keyboard.mjs agent-inbox` just works.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 6000);
const TAB_STEPS = Number(process.env.TAB_STEPS || 25);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveWorkspaceId(host, projectPath) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${host}/v2/resolve-workspace`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectPath }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const body = await response.json();
      return typeof body?.workspaceId === "string" ? body.workspaceId : null;
    } finally {
      clearTimeout(timer);
    }
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

function focusDescription(node) {
  if (!node || node === document.body) return "body";
  const tag = node.tagName?.toLowerCase() ?? "?";
  const text = (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
  const aria = node.getAttribute?.("aria-label");
  return `${tag}${aria ? `[aria=${aria.slice(0, 24)}]` : ""}${text ? ` "${text}"` : ""}`;
}

const FOCUS_STATE = `(() => {
  const el = document.activeElement;
  const style = el ? getComputedStyle(el) : null;
  return {
    tag: el?.tagName?.toLowerCase() ?? null,
    desc: ${focusDescription.toString()}(el),
    text: (el?.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 60),
    hidden: !el || style?.display === "none" || style?.visibility === "hidden",
  };
})()`;

async function main() {
  const rawWs = process.argv[2] || process.env.ZICODE_WORKSPACE;
  let sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!rawWs) {
    throw new Error(
      "Usage: node scripts/qa-keyboard.mjs <workspaceId> <sessionId>",
    );
  }
  const WORKSPACE_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let wsId = rawWs;
  if (!WORKSPACE_UUID_RE.test(rawWs)) {
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
        wsId = resolved;
        break;
      }
    }
    if (wsId === rawWs) {
      throw new Error(
        `Cannot resolve workspace from "${rawWs}". Pass a stable workspace UUID or a registered project directory path.`,
      );
    }
    console.log(`[qa-keyboard] resolved workspace ${rawWs} -> ${wsId}`);
  }
  if (!sessionId) {
    sessionId = await discoverSessionId(HOST, wsId);
    if (!sessionId) {
      throw new Error(
        "Could not discover a session for this workspace; pass <sessionId> explicitly.",
      );
    }
    console.log(`[qa-keyboard] discovered session ${sessionId}`);
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

  const sessionUrl = `${HOST}/app/workspaces/${wsId}/sessions/${sessionId}`;
  const candidates = [
    ["chat", `${sessionUrl}`],
    ["notes", `${sessionUrl}?app=com.zicode.notes`],
    ["tasks", `${sessionUrl}?app=com.zicode.tasks`],
    ["finance", `${sessionUrl}?app=com.zicode.finance`],
    ["translate", `${sessionUrl}?app=com.zicode.translate`],
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

  const profile = mkdtempSync(join(tmpdir(), "zicode-keyboard-"));
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
    for (const [name, url] of apps) {
      await cdp.send("Page.navigate", { url });
      await sleep(WAIT_MS);

      const boot = await cdp.send("Runtime.evaluate", {
        expression: `document.body?.classList.contains("startup-failed") ?? false`,
        returnByValue: true,
      });
      if (boot?.result?.value === true) {
        const entry = {
          name,
          focusableSeen: 0,
          firstFocus: null,
          issues: ["page rendered the startup-failure screen (session route not loaded)"],
          shortcut: { opened: false, resultCount: 0, closedByEsc: false },
        };
        report.push(entry);
        console.log(JSON.stringify({ ...entry, pass: false }));
        continue;
      }

      // Tab walk: collect the focus path and flag traps/invisible focus.
      const walk = [];
      let bodyStreak = 0;
      const issues = [];
      for (let step = 0; step < TAB_STEPS; step += 1) {
        await cdp.send("Input.dispatchKeyEvent", {
          type: "rawKeyDown",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
        });
        await cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
        });
        await sleep(80);
        const state = await cdp.send("Runtime.evaluate", {
          expression: FOCUS_STATE,
          returnByValue: true,
        });
        const focus = state?.result?.value ?? { tag: null, desc: "?" };
        walk.push(focus);
        if (focus.tag === null || focus.tag === "body") {
          bodyStreak += 1;
          if (bodyStreak >= 3) {
            issues.push(`focus stuck on body after ${step + 1} tabs`);
            break;
          }
        } else {
          bodyStreak = 0;
        }
        if (focus.hidden) {
          issues.push(`focus landed on hidden element at tab ${step + 1}: ${focus.desc}`);
        }
      }

      // Global shortcut: Ctrl+K opens the session search dialog from anywhere.
      let shortcut = null;
      try {
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "k",
                code: "KeyK",
                ctrlKey: true,
                bubbles: true,
                cancelable: true,
              }),
            );
            return true;
          })()`,
        });
        await sleep(500);
        const search = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const dialog = document.querySelector(
              "#session-search-dialog, .session-search-dialog",
            );
            return {
              visible: Boolean(
                dialog &&
                  getComputedStyle(dialog).display !== "none" &&
                  !dialog.classList.contains("hidden") &&
                  dialog.getAttribute("aria-hidden") !== "true",
              ),
              resultCount:
                dialog?.querySelectorAll(".session-search-result, li").length ?? 0,
            };
          })()`,
          returnByValue: true,
        });
        const opened = search?.result?.value ?? { visible: false, resultCount: 0 };
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                bubbles: true,
                cancelable: true,
              }),
            );
            return true;
          })()`,
        });
        await sleep(400);
        const afterEsc = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const dialog = document.querySelector(
              "#session-search-dialog, .session-search-dialog",
            );
            return (
              !dialog ||
              getComputedStyle(dialog).display === "none" ||
              dialog.classList.contains("hidden") ||
              dialog.getAttribute("aria-hidden") === "true"
            );
          })()`,
          returnByValue: true,
        });
        shortcut = {
          opened: opened.visible,
          resultCount: opened.resultCount,
          closedByEsc: afterEsc?.result?.value === true,
        };
        if (!shortcut.opened) issues.push("Ctrl+K did not open the session search dialog");
        else if (!shortcut.closedByEsc) issues.push("Escape did not close the session search dialog");
      } catch {
        shortcut = { opened: false, error: "shortcut probe failed" };
      }

      // Other documented global shortcuts (palette, model dropdown). The
      // workspace switcher (Ctrl+Shift+O) and new-session (Ctrl+Shift+N) rely
      // on the Tauri invoke bridge, so they are exercised on the real window
      // (bench-desktop-ui) rather than in headless Chrome.
      const globalShortcuts = [];
      try {
        const paletteOpen = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
            return true;
          })()`,
        });
        await sleep(500);
        const paletteVisible = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const panel = document.querySelector("#command-palette");
            return Boolean(panel && getComputedStyle(panel).display !== "none");
          })()`,
          returnByValue: true,
        });
        globalShortcuts.push({
          name: "Ctrl+Shift+P palette",
          ok: paletteVisible?.result?.value === true,
        });
        await cdp.send("Runtime.evaluate", {
          expression: `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`,
        });
        await sleep(400);
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true, bubbles: true, cancelable: true }));
            return true;
          })()`,
        });
        await sleep(500);
        const modelVisible = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const menu = document.getElementById("model-dropdown-menu");
            return Boolean(menu && !menu.classList.contains("hidden"));
          })()`,
          returnByValue: true,
        });
        globalShortcuts.push({
          name: "Ctrl+M model dropdown",
          ok: modelVisible?.result?.value === true,
        });
        await cdp.send("Runtime.evaluate", {
          expression: `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); true`,
        });
      } catch {
        globalShortcuts.push({ name: "global shortcuts probe failed", ok: false });
      }
      for (const probe of globalShortcuts) {
        if (!probe.ok) issues.push(`${probe.name} did not open`);
      }

      const firstFocus = walk.find((entry) => entry.tag !== null && entry.tag !== "body");
      report.push({
        name,
        focusableSeen: walk.filter((entry) => entry.tag !== null && entry.tag !== "body").length,
        firstFocus: firstFocus?.desc ?? null,
        issues,
        shortcut,
      });
      console.log(
        JSON.stringify({
          name,
          focusableSeen: report.at(-1).focusableSeen,
          firstFocus: report.at(-1).firstFocus,
          issues,
          shortcut,
          pass: issues.length === 0 && shortcut?.opened && shortcut?.closedByEsc,
        }),
      );
    }

    const failures = report.filter((entry) => entry.issues.length > 0);
    console.log(
      `KEYBOARD SWEEP: ${report.length - failures.length}/${report.length} views clean` +
        (failures.length > 0
          ? ` (${failures.map((entry) => entry.name).join(", ")} have issues)`
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
