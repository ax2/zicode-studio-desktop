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

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out after ${ms}ms: ${label}`)),
        ms,
      ),
    ),
  ]);
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
  // Prefer the actual session header class over any bare header element
  // (e.g. the hidden help-center header), so the clipping diagnostic measures
  // against the visible toolbar instead of a zero-height node.
  const header = document.querySelector(
    ".header.session-header, .header, .app-header, .plugin-app-header, .topbar",
  );
  const headerVisible =
    header &&
    getComputedStyle(header).display !== "none" &&
    header.getBoundingClientRect().height > 0;
  const headerRect = headerVisible ? header.getBoundingClientRect() : null;
  // Notes-specific toolbar (the top button row that was reported as clipped).
  const notesToolbar = document.querySelector(".notes-editor-toolbar");
  const notesToolbarRect = notesToolbar ? notesToolbar.getBoundingClientRect() : null;
  const notifications = Array.from(
    document.querySelectorAll(".native-notification"),
  ).map((notification) => notification.innerText.replace(/\\s+/g, " ").trim());
  const messages = document.querySelector(".messages");
  const lastMessage = messages?.lastElementChild;
  const inputArea = document.querySelector(".input-area");
  const chatGap =
    lastMessage && inputArea
      ? Math.round(
          inputArea.getBoundingClientRect().top -
            lastMessage.getBoundingClientRect().bottom,
        )
      : null;
  // First button anywhere in the document, to detect top clipping generally.
  const firstButton = document.querySelector(".plugin-main-view button, main button, .app-main button, .plugin-app-mount button, .notes-editor-toolbar button");
  const firstButtonRect = firstButton ? firstButton.getBoundingClientRect() : null;
  const clippedByHeader =
    firstButtonRect && headerRect && firstButtonRect.top < headerRect.bottom
      ? firstButtonRect.top - headerRect.bottom
      : 0;
  const clippedAtViewportTop =
    mainRect && mainRect.top < 0 ? Math.round(mainRect.top) : 0;
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
    clippedAtViewportTop,
    notesToolbarRect: notesToolbarRect && { top: Math.round(notesToolbarRect.top), bottom: Math.round(notesToolbarRect.bottom), height: Math.round(notesToolbarRect.height) },
    notifications,
    chatGap,
    messagesBottomAligned: messages?.classList.contains("messages-bottom-aligned") ?? null,
    firstButtonRect: firstButtonRect && { top: Math.round(firstButtonRect.top), bottom: Math.round(firstButtonRect.bottom), left: Math.round(firstButtonRect.left), width: Math.round(firstButtonRect.width) },
    clippedByHeader: Math.round(clippedByHeader),
    containers,
    activityListInfo,
  };
})()`;

async function diagnose(cdp, name, url, viewport) {
  await openPage(cdp, url);
  let shortcutActive = null;
  let notesEditor = null;
  let appForm = null;
  let mobileMore = null;
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
    const beforeEdit = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const preview = !!document.querySelector(".notes-preview");
        const toolbarButtons = Array.from(
          document.querySelectorAll(".notes-editor-toolbar button"),
        )
          .map((button) => button.getAttribute("aria-label") || button.textContent?.trim())
          .filter(Boolean);
        document.querySelector(".notes-edit-tab")?.click();
        return { preview, toolbarButtons };
      })()`,
      returnByValue: true,
    });
    await sleep(700);
    const afterEdit = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const textarea = !!document.querySelector(".notes-content-input");
        const tagEditor = !!document.querySelector(".notes-tag-editor");
        return { textarea, tagEditor };
      })()`,
      returnByValue: true,
    });
    notesEditor = {
      previewDefault: beforeEdit?.result?.value?.preview ?? null,
      editMode: afterEdit?.result?.value?.textarea ?? null,
      tagEditor: afterEdit?.result?.value?.tagEditor ?? null,
      toolbarButtons: beforeEdit?.result?.value?.toolbarButtons ?? [],
    };
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
    // Switch back to chat so the final layout diagnostic measures the chat
    // view instead of the project view the shortcut just opened.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, bubbles: true, cancelable: true }));
        return true;
      })()`,
    });
    await sleep(700);
  }
  // For the automation app, verify the create-workflow form is fully rendered
  // and the schedule selector exposes its options.
  if (name === "automation") {
    const formResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const select = document.querySelector("#automation-schedule");
        const checkbox = document.querySelector(".automation-checkbox input[type='checkbox']");
        return {
          name: !!document.querySelector("#automation-name"),
          targetProject: !!document.querySelector("#automation-target"),
          prompt: !!document.querySelector("#automation-prompt"),
          schedule: !!select,
          scheduleOptions: select
            ? Array.from(select.options).map((option) => option.textContent)
            : [],
          approval: !!checkbox,
          submit: !!document.querySelector(".automation-form button[type='submit']"),
        };
      })()`,
      returnByValue: true,
    });
    appForm = formResult?.result?.value ?? null;
  }
  // For the finance app in the Finance scene, open the research view and verify
  // the research-card form fields.
  if (name === "finance") {
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const item = Array.from(document.querySelectorAll(".finance-nav-item")).find(
          (button) => /研究工作区|Research workspace/.test(button.textContent || ""),
        );
        item?.click();
        return !!item;
      })()`,
    });
    await sleep(500);
    const researchResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('[data-finance-view="research"] form');
        if (!form) return { sceneGuard: true, researchForm: false };
        const inputs = Array.from(form.querySelectorAll("input"));
        const textareas = Array.from(form.querySelectorAll("textarea"));
        return {
          sceneGuard: false,
          researchForm: true,
          inputs: inputs.length,
          textareas: textareas.length,
          submit: !!form.querySelector('button[type="submit"]'),
        };
      })()`,
      returnByValue: true,
    });
    appForm = researchResult?.result?.value ?? null;
    // Also verify the paper-trading "Create account" form.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const item = Array.from(document.querySelectorAll(".finance-nav-item")).find(
          (button) => /模拟交易|Paper trading/.test(button.textContent || ""),
        );
        item?.click();
        return !!item;
      })()`,
    });
    await sleep(500);
    const paperResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('[data-finance-view="paper"] form');
        if (!form) return { paperForm: false };
        const inputs = Array.from(form.querySelectorAll("input"));
        return {
          paperForm: true,
          inputs: inputs.length,
          submit: !!form.querySelector('button[type="submit"]'),
        };
      })()`,
      returnByValue: true,
    });
    appForm = { ...(appForm ?? {}), ...(paperResult?.result?.value ?? {}) };
    // Verify a representative JSON-driven view (backtest) renders its textarea,
    // sample helper, and submit control.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const item = Array.from(document.querySelectorAll(".finance-nav-item")).find(
          (button) => /策略回测|Strategy backtest/.test(button.textContent || ""),
        );
        item?.click();
        return !!item;
      })()`,
    });
    await sleep(500);
    const backtestResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const view = document.querySelector('[data-finance-view="backtest"]');
        if (!view) return { backtest: false };
        return {
          backtest: true,
          textarea: !!view.querySelector("textarea"),
          sample: Array.from(view.querySelectorAll("button")).some((button) =>
            /Insert sample|插入示例/.test(button.textContent || ""),
          ),
          submit: !!view.querySelector('button[type="submit"]'),
        };
      })()`,
      returnByValue: true,
    });
    appForm = { ...(appForm ?? {}), ...(backtestResult?.result?.value ?? {}) };
  }
  // On the mobile shell, exercise the "More" application menu.
  if (viewport.width < 700) {
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector("[data-mobile-activity-more]")?.click();
        return true;
      })()`,
    });
    await sleep(400);
    const moreResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const menu = document.querySelector("[data-mobile-activity-menu]");
        const items = Array.from(
          menu?.querySelectorAll("[data-mobile-plugin-id]") ?? [],
        ).map((item) => item.getAttribute("aria-label") || item.textContent?.trim());
        return {
          open: !!menu && !menu.hasAttribute("hidden"),
          itemCount: items.length,
          items,
        };
      })()`,
      returnByValue: true,
    });
    mobileMore = moreResult?.result?.value ?? null;
    // Close the menu so the subsequent layout diagnostics measure the app,
    // not the overlay.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector("[data-mobile-activity-menu-close]")?.click();
        document.querySelector("[data-mobile-activity-backdrop]")?.click();
        return true;
      })()`,
    });
    await sleep(300);
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
  return { name, url, viewport, shortcutActive, notesEditor, appForm, mobileMore, ...result, screenshot: file };
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

    // Finance is scene-gated: opening it in a non-finance session renders the
    // scene guard instead of the research/paper/backtest forms. Create a
    // finance-scene session here so the QA pass exercises the real workbench
    // rather than always reporting `sceneGuard: true`. If creating the session
    // fails, fall back to the original URL so the guard diagnostic is still
    // captured.
    let financeUrl = `${sessionUrl}?app=com.zicode.finance`;
    try {
      const controller = new AbortController();
      const financeTimer = setTimeout(() => controller.abort(), 8000);
      const financeResponse = await fetch(`${HOST}/v2/new-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: ws, sceneId: "finance" }),
        signal: controller.signal,
      });
      clearTimeout(financeTimer);
      if (financeResponse.ok) {
        const financeTarget = await financeResponse.json();
        if (financeTarget?.sessionId) {
          financeUrl = `${HOST}/app/workspaces/${ws}/sessions/${financeTarget.sessionId}?app=com.zicode.finance`;
        }
      }
    } catch {
      // Keep the scene-guard URL; the existing diagnostic remains useful.
    }

    const allApps = [
      ["chat", `${sessionUrl}`],
      ["notes", `${sessionUrl}?app=com.zicode.notes`],
      ["projects", `${sessionUrl}?app=com.zicode.projects`],
      ["tasks", `${sessionUrl}?app=com.zicode.tasks`],
      ["automation", `${sessionUrl}?app=com.zicode.automation`],
      ["finance", financeUrl],
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
      ["articles", `${sessionUrl}?app=com.zicode.articles`],
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
        let result;
        try {
          result = await withTimeout(
            diagnose(cdp, name, url, viewport),
            30000,
            `diagnose ${name}`,
          );
        } catch (error) {
          result = {
            name,
            viewport,
            error: error instanceof Error ? error.message : String(error),
            startupFailure: null,
            activePluginId: null,
            overflowX: null,
            clippedByHeader: null,
            clippedAtViewportTop: null,
          };
        }
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
            clippedAtViewportTop: result.clippedAtViewportTop,
            firstButtonTop: result.firstButtonRect?.top ?? null,
            headerBottom: result.headerRect?.bottom ?? null,
            notesToolbarTop: result.notesToolbarRect?.top ?? null,
            notifications: result.notifications ?? [],
            chatGap: result.chatGap ?? null,
            messagesBottomAligned: result.messagesBottomAligned ?? null,
            bodyText: result.bodyText,
            activityList: result.activityListInfo,
            shortcutActive: result.shortcutActive,
            notesEditor: result.notesEditor,
            appForm: result.appForm,
            mobileMore: result.mobileMore,
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
