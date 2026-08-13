// Visual QA harness: renders every desktop app/plugin in headless Chrome and
// reports layout diagnostics (startup failure, active plugin, horizontal
// overflow, top clipping) while saving screenshots for human review.
//
// Usage (app must be running on localhost):
//   node scripts/visual-qa.mjs <workspaceId> <sessionId>
//   APP_FILTER=notes node scripts/visual-qa.mjs <workspaceId> <sessionId>
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const PORT = Number(process.env.CDP_PORT || 9223);
const OUT_DIR = process.env.OUT_DIR || join(process.cwd(), "docs", "screenshots");
const WAIT_MS = Number(process.env.WAIT_MS || 8000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome hasn't started its DevTools server yet.
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
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
    ws.addEventListener("error", (event) => reject(new Error(String(event.message || "ws error"))));
  });
}

async function openPage(cdp, url) {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url });
  await sleep(WAIT_MS);
}

const DIAGNOSTICS = `(() => {
  const doc = document.documentElement;
  const body = document.body;
  const startupFailure = !!document.querySelector("[data-startup-failure], .startup-failure");
  const overflowX = doc.scrollWidth > doc.clientWidth;
  const overflowY = doc.scrollHeight > doc.clientHeight;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const title = document.title;
  const activePlugin = document.querySelector(".plugin-activity-button.active, .plugin-activity-button[aria-current='page']");
  const activePluginId = activePlugin ? activePlugin.getAttribute("data-plugin-id") : null;
  const main = document.querySelector(".plugin-main-view, #chat-main, main, .app-main, .plugin-app-mount");
  const mainRect = main ? main.getBoundingClientRect() : null;
  const header = document.querySelector(".app-header, .plugin-app-header, header, .topbar, .header");
  const headerRect = header ? header.getBoundingClientRect() : null;
  // Notes-specific toolbar (the top button row that was reported as clipped).
  const notesToolbar = document.querySelector(".notes-editor-toolbar");
  const notesToolbarRect = notesToolbar ? notesToolbar.getBoundingClientRect() : null;
  // First button anywhere in the document, to detect top clipping generally.
  const firstButton = document.querySelector(".plugin-main-view button, main button, .app-main button, .plugin-app-mount button, .notes-editor-toolbar button");
  const firstButtonRect = firstButton ? firstButton.getBoundingClientRect() : null;
  const clippedByHeader =
    firstButtonRect && headerRect && firstButtonRect.top < headerRect.bottom
      ? firstButtonRect.top - headerRect.bottom
      : 0;
  const containers = Array.from(document.querySelectorAll("div[class], section[class]"))
    .filter((el) => /\b(notes|plugin|chat|composer|main|app|header)\b/.test(el.className))
    .slice(0, 12)
    .map((el) => el.className);
  const activityList = document.querySelector(".plugin-activity-list[data-plugin-activities]");
  const activityListInfo = activityList
    ? {
        scrollTop: activityList.scrollTop,
        scrollHeight: activityList.scrollHeight,
        clientHeight: activityList.clientHeight,
        canScrollUp: activityList.classList.contains("can-scroll-up"),
        canScrollDown: activityList.classList.contains("can-scroll-down"),
      }
    : null;
  return {
    title,
    startupFailure,
    viewport,
    overflowX,
    overflowY,
    activePluginId,
    bodyText: (body?.innerText || "").replace(/\\s+/g, " ").slice(0, 220),
    docScrollWidth: doc.scrollWidth,
    docClientWidth: doc.clientWidth,
    mainRect: mainRect && { top: Math.round(mainRect.top), bottom: Math.round(mainRect.bottom), left: Math.round(mainRect.left), width: Math.round(mainRect.width) },
    headerRect: headerRect && { top: Math.round(headerRect.top), bottom: Math.round(headerRect.bottom) },
    notesToolbarRect: notesToolbarRect && { top: Math.round(notesToolbarRect.top), bottom: Math.round(notesToolbarRect.bottom), height: Math.round(notesToolbarRect.height) },
    firstButtonRect: firstButtonRect && { top: Math.round(firstButtonRect.top), bottom: Math.round(firstButtonRect.bottom), left: Math.round(firstButtonRect.left), width: Math.round(firstButtonRect.width) },
    clippedByHeader: Math.round(clippedByHeader),
    containers,
    activityListInfo,
  };
})()`;

async function diagnose(cdp, name, url, viewport) {
  await openPage(cdp, url);
  let shortcutActive = null;
  // For the notes app, open the first note so the editor (and its toolbar,
  // which was reported as top-clipped) is actually rendered.
  if (name === "notes") {
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const item = document.querySelector(".notes-tree-note");
        if (item) { item.click(); return true; }
        const recent = document.querySelector(".notes-nav-button");
        if (recent) { recent.click(); return true; }
        return false;
      })()`,
      returnByValue: true,
    });
    await sleep(1500);
  }
  // For the chat app, exercise the Ctrl/Cmd+digit app-switch shortcut.
  if (name === "chat") {
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", ctrlKey: true, bubbles: true, cancelable: true }));
        return true;
      })()`,
    });
    await sleep(900);
    const shortcutResult = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(".plugin-activity-button.active")?.getAttribute("data-plugin-id") ?? null`,
      returnByValue: true,
    });
    shortcutActive = shortcutResult?.result?.value ?? null;
  }
  const evaluated = await cdp.send("Runtime.evaluate", {
    expression: DIAGNOSTICS,
    returnByValue: true,
  });
  const result = evaluated?.result?.value ?? null;
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${name}-${viewport.width}x${viewport.height}.png`);
  writeFileSync(file, Buffer.from(screenshot.data, "base64"));
  return { name, url, viewport, shortcutActive, ...result, screenshot: file };
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "zicode-qa-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  try {
    await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${PORT}/json`);
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("No page target found");
    const cdp = await connect(page.webSocketDebuggerUrl);

    const ws = process.argv[2] || process.env.ZICODE_WORKSPACE;
    const session = process.argv[3] || process.env.ZICODE_SESSION;
    if (!ws || !session) {
      throw new Error("Usage: node scripts/visual-qa.mjs <workspaceId> <sessionId>");
    }
    const sessionUrl = `${HOST}/app/workspaces/${ws}/sessions/${session}`;

    const allApps = [
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
      ["settings", `${sessionUrl}?app=core.settings`],
      ["help", `${sessionUrl}?app=core.help`],
    ];
    const filter = process.env.APP_FILTER;
    const apps = filter
      ? allApps.filter(([name]) => name === filter)
      : allApps;

    const viewportOverride = process.env.VIEWPORT;
    const viewports = viewportOverride
      ? [(() => {
          const [width, height] = viewportOverride.split("x").map(Number);
          return { width, height };
        })()]
      : [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
        ];

    const report = [];
    for (const viewport of viewports) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 700,
      });
      for (const [name, url] of apps) {
        const result = await diagnose(cdp, name, url, viewport);
        report.push(result);
        console.log(
          JSON.stringify({
            name,
            viewport: `${viewport.width}x${viewport.height}`,
            title: result.title,
            startupFailure: result.startupFailure,
            activePluginId: result.activePluginId,
            overflowX: result.overflowX,
            clippedByHeader: result.clippedByHeader,
            firstButtonTop: result.firstButtonRect?.top ?? null,
            headerBottom: result.headerRect?.bottom ?? null,
            notesToolbarTop: result.notesToolbarRect?.top ?? null,
            bodyText: result.bodyText,
            activityList: result.activityListInfo,
            shortcutActive: result.shortcutActive,
          }),
        );
      }
    }

    writeFileSync(join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
