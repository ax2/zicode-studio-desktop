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
    // Open the file browser panel and confirm it paints above the message
    // history rather than being covered by it (works in the normal chat
    // surface; the super-agent runtime replaces the panel in SA mode).
    const toggleVisible = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const toggle = document.querySelector("#file-sidebar-toggle");
        return Boolean(
          toggle &&
            getComputedStyle(toggle).display !== "none" &&
            toggle.getBoundingClientRect().height > 0,
        );
      })()`,
      returnByValue: true,
    });
    if (toggleVisible?.result?.value) {
      await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          document.querySelector("#file-sidebar-toggle")?.click();
          return true;
        })()`,
      });
      await sleep(500);
      const filePanelResult = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const panel = document.querySelector(".file-sidebar");
          if (!panel || panel.classList.contains("collapsed")) {
            return { open: false };
          }
          const pr = panel.getBoundingClientRect();
          const list = panel.querySelector(".file-list");
          const listRect = list?.getBoundingClientRect();
          const sampleX = Math.round(pr.left + pr.width / 2);
          const sampleY = Math.round((listRect?.top ?? pr.top) + 10);
          const topmost = document
            .elementsFromPoint(sampleX, sampleY)
            .slice(0, 3)
            .map((el) => (el.tagName + "." + el.className).slice(0, 40));
          return {
            open: true,
            panelLeft: Math.round(pr.left),
            panelWidth: Math.round(pr.width),
            listTop: listRect ? Math.round(listRect.top) : null,
            topmost,
          };
        })()`,
        returnByValue: true,
      });
      appForm = filePanelResult?.result?.value ?? null;
    } else {
      appForm = { toggleHidden: true };
    }
    // Command palette: open, filter by a query, and run a filtered command.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector("#command-btn")?.click();
        return true;
      })()`,
    });
    await sleep(500);
    const paletteOpen = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const panel = document.querySelector("#command-palette");
        return {
          visible: Boolean(panel && !panel.classList.contains("hidden")),
          itemCount: document.querySelectorAll(".command-item").length,
        };
      })()`,
      returnByValue: true,
    });
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector(".command-palette-search");
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set.call(input, "笔记");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    });
    await sleep(400);
    const paletteFiltered = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const items = Array.from(
          document.querySelectorAll(".command-item .command-label"),
        ).map((node) => node.textContent?.trim() ?? "");
        return { count: items.length, items };
      })()`,
      returnByValue: true,
    });
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector(".command-palette-search");
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        ).set.call(input, "任务");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    });
    await sleep(400);
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document
          .querySelector(".command-palette-search")
          ?.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Enter",
              bubbles: true,
              cancelable: true,
            }),
          );
        return true;
      })()`,
    });
    await sleep(1200);
    const paletteExecuted = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        paletteHidden:
          document
            .querySelector("#command-palette")
            ?.classList.contains("hidden") ?? null,
        activePlugin: document.body.dataset.activePlugin ?? null,
      }))()`,
      returnByValue: true,
    });
    appForm = {
      ...(appForm ?? {}),
      commandPalette: {
        open: paletteOpen?.result?.value ?? null,
        filtered: paletteFiltered?.result?.value ?? null,
        executed: paletteExecuted?.result?.value ?? null,
      },
    };
    // Composer: typing enables send, "/" opens the skill menu, and attaching
    // an image renders a preview.
    const composerInput = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector("#message-input");
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        ).set;
        setter.call(input, "你好，这是一条测试消息");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
      returnByValue: true,
    });
    await sleep(300);
    const sendEnabled = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const send = document.querySelector("#send-btn");
        return {
          disabled: send?.hasAttribute("disabled") ?? null,
          ariaDisabled: send?.getAttribute("aria-disabled") ?? null,
        };
      })()`,
      returnByValue: true,
    });
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector("#message-input");
        Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        ).set.call(input, "/");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    });
    await sleep(400);
    const slashMenu = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const menu = document.querySelector("#skill-slash-menu");
        return {
          visible: Boolean(menu && !menu.classList.contains("hidden")),
          optionCount: document.querySelectorAll(".skill-slash-option").length,
        };
      })()`,
      returnByValue: true,
    });
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector("#message-input");
        Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        ).set.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    });
    let imagePreview = null;
    try {
      const doc = await cdp.send("DOM.getDocument", { depth: -1 });
      const node = await cdp.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: "#image-input",
      });
      if (node.nodeId) {
        const sampleImage = join(
          process.cwd(),
          "public",
          "icons",
          "app-192.png",
        );
        await cdp.send("DOM.setFileInputFiles", {
          nodeId: node.nodeId,
          files: [sampleImage],
        });
        await sleep(1800);
        imagePreview = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const previews = document.querySelectorAll(
              ".composer-image-preview, .image-preview-item, [class*='image-preview'] img",
            );
            return {
              previewCount: previews.length,
              hasImage: Boolean(
                document.querySelector("[class*='image-preview'] img, [class*='preview'] img"),
              ),
            };
          })()`,
          returnByValue: true,
        });
        imagePreview = imagePreview?.result?.value ?? null;
      }
    } catch {
      imagePreview = { error: "image attach not testable" };
    }
    appForm = {
      ...(appForm ?? {}),
      composer: {
        typed: Boolean(composerInput?.result?.value),
        send: sendEnabled?.result?.value ?? null,
        slash: slashMenu?.result?.value ?? null,
        image: imagePreview,
      },
    };
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
    // Create a research card through the form, verify it appears, then remove
    // it (confirm stubbed) so the workspace stays clean.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('[data-finance-view="research"] form');
        if (!form) return false;
        const inputs = Array.from(form.querySelectorAll("input"));
        const textareas = Array.from(form.querySelectorAll("textarea"));
        const setValue = (element, value) => {
          const prototype =
            element.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(
            element,
            value,
          );
          element.dispatchEvent(new Event("input", { bubbles: true }));
        };
        // Fields are positional (Symbol, Research title, …) so the diagnostic
        // works regardless of the active UI language.
        setValue(inputs[0], "QA.TEST");
        setValue(inputs[1], "QA 研究卡片");
        setValue(textareas[0], "这是自动化回归创建的测试论点。");
        return inputs.length >= 2 && textareas.length >= 1;
      })()`,
    });
    await sleep(300);
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const submit = document.querySelector(
          '[data-finance-view="research"] form button[type="submit"]',
        );
        submit?.click();
        return Boolean(submit);
      })()`,
    });
    await sleep(1800);
    const researchCard = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        cardFound: Array.from(
          document.querySelectorAll(".finance-research-card h4"),
        ).some((node) => node.textContent?.includes("QA 研究卡片")),
        notifications: Array.from(
          document.querySelectorAll(".native-notification"),
        ).map((node) => node.innerText.replace(/\\s+/g, " ").trim()),
        error: document.querySelector(".finance-research-error")?.textContent ?? "",
      }))()`,
      returnByValue: true,
    });
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        globalThis.confirm = () => true;
        const card = Array.from(
          document.querySelectorAll(".finance-research-card"),
        ).find((node) => (node.textContent || "").includes("QA 研究卡片"));
        const remove = Array.from(
          card?.querySelectorAll("button") ?? [],
        ).find((button) => /Remove|删除|移除/.test(button.textContent || ""));
        remove?.click();
        return Boolean(remove);
      })()`,
    });
    await sleep(1200);
    const researchRemoved = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        cardGone: !Array.from(
          document.querySelectorAll(".finance-research-card h4"),
        ).some((node) => node.textContent?.includes("QA 研究卡片")),
      }))()`,
      returnByValue: true,
    });
    appForm = {
      ...(appForm ?? {}),
      researchCard: researchCard?.result?.value ?? null,
      researchRemoved: researchRemoved?.result?.value ?? null,
    };
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
  // For the settings app, exercise the theme dropdown: it must render its
  // options in-DOM (not vanish until hover) and the trigger label must follow
  // the selection immediately.
  if (name === "settings") {
    const themeResult = await cdp.send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const trigger = document.querySelector("#theme-select");
        if (!trigger) return { found: false };
        const before = trigger.querySelector(".app-select-value")?.textContent?.trim();
        trigger.click();
        await wait(400);
        const menu = document.querySelector("#theme-select-listbox");
        const rect = menu?.getBoundingClientRect();
        const options = Array.from(menu?.querySelectorAll(".app-select-option") ?? []);
        const visible =
          !!menu && rect && rect.height > 0 && options.length > 0;
        const current = trigger.querySelector(".app-select-value")?.textContent?.trim();
        const target = options.find((option) => option.textContent?.trim() !== current);
        const beforeTheme = document.documentElement.dataset.theme ?? "";
        target?.click();
        await wait(500);
        const after = trigger.querySelector(".app-select-value")?.textContent?.trim();
        const afterTheme = document.documentElement.dataset.theme ?? "";
        const cookie = document.cookie;
        return {
          found: true,
          before,
          menuVisible: visible,
          optionCount: options.length,
          menuRect: rect && {
            top: Math.round(rect.top),
            height: Math.round(rect.height),
          },
          switched: before !== after,
          labelFollowed: Boolean(after && after !== before),
          themeChanged: beforeTheme !== afterTheme,
          cookiePersisted: cookie.includes("pi-studio-theme="),
        };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    appForm = themeResult?.result?.value ?? null;
    // Remote-access tab: the E2EE identity and CA fingerprint must surface so
    // mobile users can verify the connection.
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        document.querySelector("#settings-remote-access")?.click();
        return true;
      })()`,
    });
    await sleep(900);
    const remoteResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const rows = Array.from(
          document.querySelectorAll(".remote-access-relay-device"),
        ).map((node) => ({
          label: node.querySelector("span")?.textContent?.trim() ?? "",
          value: node.querySelector("code")?.textContent?.trim() ?? "",
        }));
        const fingerprint =
          document
            .querySelector(".remote-access-fingerprint")
            ?.textContent?.replace(/\\s+/g, " ")
            .trim() ?? "";
        return {
          tabOpen: document.querySelectorAll(".remote-access-relay-device").length > 0,
          rows,
          fingerprint,
          e2eeRow:
            rows.find(
              (row) => row.label.includes("E2EE") || row.label.includes("端到端"),
            ) ?? null,
          caFingerprintShown: fingerprint.includes("CA") && fingerprint.length > 12,
        };
      })()`,
      returnByValue: true,
    });
    appForm = {
      ...(appForm ?? {}),
      remote: remoteResult?.result?.value ?? null,
    };
  }
  // For the plugin manager, exercise the enable/disable toggle on a
  // disabled-by-default plugin (Articles) and confirm the state round-trips
  // through the backend before restoring it.
  if (name === "plugin-manager") {
    const toggle = async (expression) => {
      const response = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      return response?.result?.value ?? null;
    };
    const initial = await toggle(`(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const card = Array.from(document.querySelectorAll(".plugin-manager-card")).find(
        (node) => (node.textContent || "").includes("com.zicode.articles"),
      );
      if (!card) return { found: false };
      const button = card.querySelector(".plugin-manager-card-actions button");
      return {
        found: true,
        pressed: button?.getAttribute("aria-pressed") ?? null,
        label: button?.textContent?.trim() ?? "",
      };
    })()`);
    let enabledAfterToggle = null;
    let restored = null;
    if (initial?.found) {
      await toggle(`(() => {
        const card = Array.from(document.querySelectorAll(".plugin-manager-card")).find(
          (node) => (node.textContent || "").includes("com.zicode.articles"),
        );
        card?.querySelector(".plugin-manager-card-actions button")?.click();
        return true;
      })()`);
      await sleep(1600);
      enabledAfterToggle = await toggle(`(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const card = Array.from(document.querySelectorAll(".plugin-manager-card")).find(
          (node) => (node.textContent || "").includes("com.zicode.articles"),
        );
        const button = card?.querySelector(".plugin-manager-card-actions button");
        return {
          pressed: button?.getAttribute("aria-pressed") ?? null,
          label: button?.textContent?.trim() ?? "",
        };
      })()`);
      // Restore the original state.
      await toggle(`(() => {
        const card = Array.from(document.querySelectorAll(".plugin-manager-card")).find(
          (node) => (node.textContent || "").includes("com.zicode.articles"),
        );
        card?.querySelector(".plugin-manager-card-actions button")?.click();
        return true;
      })()`);
      await sleep(1600);
      restored = await toggle(`(() => {
        const card = Array.from(document.querySelectorAll(".plugin-manager-card")).find(
          (node) => (node.textContent || "").includes("com.zicode.articles"),
        );
        return {
          pressed:
            card?.querySelector(".plugin-manager-card-actions button")?.getAttribute(
              "aria-pressed",
            ) ?? null,
        };
      })()`);
    }
    appForm = {
      initial,
      enabledAfterToggle,
      restored,
    };
  }
  // For the image tools app, attach a real image and run a process so the
  // frontend downscale, thumbnail render, backend processing and result
  // preview are exercised end-to-end.
  if (name === "imagetools") {
    let imageTools = null;
    try {
      const doc = await cdp.send("DOM.getDocument", { depth: -1 });
      const node = await cdp.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: '.plugin-main-view input[type="file"]',
      });
      if (!node.nodeId) {
        imageTools = { fileInputFound: false };
      } else {
        const sampleImage = join(
          process.cwd(),
          "public",
          "icons",
          "app-192.png",
        );
        await cdp.send("DOM.setFileInputFiles", {
          nodeId: node.nodeId,
          files: [sampleImage],
        });
        await sleep(1500);
        const thumb = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const imgs = document.querySelectorAll(".imagetools-thumb img");
            return {
              thumbCount: imgs.length,
              loaded: Array.from(imgs).some(
                (img) => img.complete && img.naturalWidth > 0,
              ),
            };
          })()`,
          returnByValue: true,
        });
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const button = document.querySelector(
              ".plugin-main-view .idphoto-generate-row .ui-button",
            );
            button?.click();
            return Boolean(button);
          })()`,
        });
        await sleep(2500);
        const result = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const img = document.querySelector(".imagetools-result-image");
            const meta = document.querySelector(".imagetools-result-meta");
            return {
              hasResultImage: Boolean(img && img.src),
              resultLoaded: Boolean(
                img && img.complete && img.naturalWidth > 0,
              ),
              meta: meta?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
              error: document.querySelector(".idphoto-error")?.textContent ?? "",
            };
          })()`,
          returnByValue: true,
        });
        imageTools = {
          fileInputFound: true,
          thumb: thumb?.result?.value ?? null,
          result: result?.result?.value ?? null,
        };
      }
    } catch (error) {
      imageTools = { error: String(error?.message || error) };
    }
    appForm = imageTools;
  }
  // For the ID photo app, attach a real photo, generate a layout, and verify
  // the printable sheet result renders (exercises the Rust idphoto pipeline).
  if (name === "idphoto") {
    let idPhoto = null;
    try {
      const doc = await cdp.send("DOM.getDocument", { depth: -1 });
      const node = await cdp.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: '.plugin-main-view input[type="file"]',
      });
      if (!node.nodeId) {
        idPhoto = { fileInputFound: false };
      } else {
        const sampleImage = join(
          process.cwd(),
          "public",
          "icons",
          "app-192.png",
        );
        await cdp.send("DOM.setFileInputFiles", {
          nodeId: node.nodeId,
          files: [sampleImage],
        });
        await sleep(1500);
        await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const button = document.querySelector(
              ".plugin-main-view .idphoto-generate-row .ui-button",
            );
            button?.click();
            return Boolean(button);
          })()`,
        });
        await sleep(3000);
        const result = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const img = document.querySelector(".idphoto-result-image");
            const meta = document.querySelector(".idphoto-result-meta");
            return {
              hasResultImage: Boolean(img && img.src),
              resultLoaded: Boolean(
                img && img.complete && img.naturalWidth > 0,
              ),
              meta: meta?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
              error: document.querySelector(".idphoto-error")?.textContent ?? "",
            };
          })()`,
          returnByValue: true,
        });
        idPhoto = {
          fileInputFound: true,
          result: result?.result?.value ?? null,
        };
      }
    } catch (error) {
      idPhoto = { error: String(error?.message || error) };
    }
    appForm = idPhoto;
  }
  // For the documents app, attach a real DOCX through the file input and
  // verify the UI imports it and renders the Markdown preview.
  if (name === "documents") {
    let documents = null;
    let tmpDocx = null;
    try {
      const { zipSync, strToU8 } = await import("fflate");
      const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>UI 导入测试标题</w:t></w:r></w:p>
    <w:p><w:r><w:t>这是 UI 导入回归的正文。</w:t></w:r></w:p>
  </w:body>
</w:document>`;
      const docxBytes = zipSync({ "word/document.xml": strToU8(xml) });
      tmpDocx = join(tmpdir(), `qa-ui-docx-${Date.now()}.docx`);
      writeFileSync(tmpDocx, Buffer.from(docxBytes));

      const doc = await cdp.send("DOM.getDocument", { depth: -1 });
      const node = await cdp.send("DOM.querySelector", {
        nodeId: doc.root.nodeId,
        selector: '.documents-main input[type="file"]',
      });
      if (!node.nodeId) {
        documents = { fileInputFound: false };
      } else {
        await cdp.send("DOM.setFileInputFiles", {
          nodeId: node.nodeId,
          files: [tmpDocx],
        });
        await sleep(2500);
        const result = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const header = document.querySelector(".documents-result-header");
            const markdown = document.querySelector(
              ".documents-markdown, .markdown-body",
            );
            return {
              fileName: header?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
              hasMarkdown: Boolean(markdown),
              contentShown:
                (markdown?.textContent ?? "").includes("UI 导入测试标题") ||
                (document.querySelector(".documents-result")?.textContent ?? "")
                  .includes("UI 导入测试标题"),
              error: document.querySelector(".documents-error")?.textContent ?? "",
            };
          })()`,
          returnByValue: true,
        });
        documents = {
          fileInputFound: true,
          result: result?.result?.value ?? null,
        };
      }
    } catch (error) {
      documents = { error: String(error?.message || error) };
    } finally {
      if (tmpDocx) {
        try {
          rmSync(tmpDocx, { force: true });
        } catch {
          // Best-effort cleanup.
        }
      }
    }
    appForm = documents;
  }
  // For the clipboard app, capture text into the inbox and send it to a note;
  // the created note is then removed through the notes API.
  if (name === "clipboard") {
    const wsMatch = url.match(/\/workspaces\/([^/]+)/);
    const clipWorkspace = wsMatch?.[1];
    const clipText = "QA 剪贴板回归内容";
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const input = document.querySelector(".clipboard-textarea");
        Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          "value",
        ).set.call(input, ${JSON.stringify(clipText)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    });
    await sleep(300);
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const add = Array.from(
          document.querySelectorAll(".clipboard-composer-actions button"),
        ).find((button) =>
          /Add to inbox|添加到收件箱/.test(button.textContent || ""),
        );
        add?.click();
        return Boolean(add);
      })()`,
    });
    await sleep(1200);
    const added = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const items = Array.from(
          document.querySelectorAll(".clipboard-item-text"),
        ).map((node) => node.textContent?.trim() ?? "");
        return {
          count: items.length,
          hasItem: items.includes("QA 剪贴板回归内容"),
          actionButtons:
            document.querySelectorAll(".clipboard-item-actions button").length,
        };
      })()`,
      returnByValue: true,
    });
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const send = Array.from(
          document.querySelectorAll(".clipboard-item-actions button"),
        ).find((button) =>
          /Send to note|发送到笔记/.test(button.textContent || ""),
        );
        send?.click();
        return Boolean(send);
      })()`,
    });
    await sleep(1500);
    const sendState = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        error:
          document.querySelector(".clipboard-main .idphoto-error")?.textContent ??
          "",
        notifications: Array.from(
          document.querySelectorAll(".native-notification"),
        ).map((node) => node.innerText.replace(/\\s+/g, " ").trim()),
        items: Array.from(
          document.querySelectorAll(".clipboard-item-text"),
        ).map((node) => node.textContent?.trim() ?? ""),
      }))()`,
      returnByValue: true,
    });
    // Confirm the note was created through the backend, then clean up.
    let noteCreated = false;
    try {
      if (clipWorkspace) {
        const noteList = await fetch(
          `${HOST}/v2/notes?workspaceId=${clipWorkspace}&sceneId=programming&query=${encodeURIComponent("QA 剪贴板回归内容")}`,
        );
        const noteBody = await noteList.json();
        noteCreated = (noteBody?.snapshot?.notes || []).some((note) =>
          (note.title || "").includes("QA 剪贴板回归内容"),
        );
      }
    } catch {
      noteCreated = false;
    }
    try {
      if (clipWorkspace) {
        const noteList = await fetch(
          `${HOST}/v2/notes?workspaceId=${clipWorkspace}&sceneId=programming&query=${encodeURIComponent("QA 剪贴板回归内容")}`,
        );
        const noteBody = await noteList.json();
        const note = (noteBody?.snapshot?.notes || []).find((entry) =>
          (entry.title || "").includes("QA 剪贴板回归内容"),
        );
        if (note?.id && note?.notebookId) {
          await fetch(`${HOST}/v2/notes/delete`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              workspaceId: clipWorkspace,
              sceneId: "programming",
              notebookId: note.notebookId,
              noteId: note.id,
              expectedVersion: note.version ?? "",
            }),
          });
        }
        await fetch(`${HOST}/v2/clipboard/clear`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: clipWorkspace,
            sceneId: "programming",
          }),
        });
      }
    } catch {
      // Cleanup is best-effort.
    }
    appForm = {
      added: added?.result?.value ?? null,
      sendState: sendState?.result?.value ?? null,
      noteCreated,
    };
  }
  // For the automation app, create a workflow through the form, confirm it
  // appears in the list, then remove it (with confirm stubbed) so the run
  // history stays untouched.
  if (name === "automation") {
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const setValue = (element, value) => {
          const prototype =
            element.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, "value").set.call(
            element,
            value,
          );
          element.dispatchEvent(new Event("input", { bubbles: true }));
        };
        setValue(document.querySelector("#automation-name"), "QA 自动化回归");
        setValue(
          document.querySelector("#automation-prompt"),
          "测试自动化任务说明",
        );
        return true;
      })()`,
    });
    await sleep(300);
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const button = document.querySelector(
          ".automation-form button[type='submit']",
        );
        button?.click();
        return Boolean(button);
      })()`,
    });
    await sleep(1800);
    const created = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        cardFound: Array.from(
          document.querySelectorAll(".automation-card h2"),
        ).some((node) => node.textContent?.includes("QA 自动化回归")),
        notifications: Array.from(
          document.querySelectorAll(".native-notification"),
        ).map((node) => node.innerText.replace(/\\s+/g, " ").trim()),
      }))()`,
      returnByValue: true,
    });
    // Remove every QA card (including any leftovers from earlier runs).
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        globalThis.confirm = () => true;
        const cards = Array.from(
          document.querySelectorAll(".automation-card"),
        ).filter((node) => (node.textContent || "").includes("QA 自动化回归"));
        for (const card of cards) {
          const remove = Array.from(
            card.querySelectorAll("button"),
          ).find((button) => /Remove|删除|移除/.test(button.textContent || ""));
          remove?.click();
        }
        return cards.length;
      })()`,
    });
    await sleep(1500);
    const removed = await cdp.send("Runtime.evaluate", {
      expression: `(() => ({
        cardGone: !Array.from(
          document.querySelectorAll(".automation-card h2"),
        ).some((node) => node.textContent?.includes("QA 自动化回归")),
      }))()`,
      returnByValue: true,
    });
    appForm = {
      created: created?.result?.value ?? null,
      removed: removed?.result?.value ?? null,
    };
  }
  // For the task center, verify the list renders and the status filters
  // actually narrow the visible cards (read-only; no task mutation).
  if (name === "tasks") {
    // Give the async load a moment, then capture any error state too.
    await sleep(1500);
    const initial = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const cards = Array.from(
          document.querySelectorAll(".task-center-card"),
        );
        const statePanel = document.querySelector(".task-center-state");
        const errorPanel = document.querySelector(".task-center-error");
        const summary = Array.from(
          document.querySelectorAll(".task-center-summary-card"),
        ).map((node) => ({
          count: node.querySelector("strong")?.textContent?.trim() ?? "",
          label: node.querySelector("span")?.textContent?.trim() ?? "",
        }));
        return {
          cardCount: cards.length,
          statuses: cards.map((card) =>
            Array.from(card.classList)
              .find((name) => name.startsWith("status-"))
              ?.slice(7) ?? "",
          ),
          summary,
          stateText: statePanel?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
          errorText: errorPanel?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
        };
      })()`,
      returnByValue: true,
    });
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const running = Array.from(
          document.querySelectorAll(".task-center-filter"),
        ).find((button) =>
          /Running|运行中/.test(button.textContent || ""),
        );
        running?.click();
        return Boolean(running);
      })()`,
    });
    await sleep(800);
    const filtered = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const cards = Array.from(
          document.querySelectorAll(".task-center-card"),
        );
        return {
          cardCount: cards.length,
          activeFilter:
            document
              .querySelector(".task-center-filter[aria-pressed='true']")
              ?.textContent?.replace(/\\s+/g, " ")
              .trim() ?? "",
        };
      })()`,
      returnByValue: true,
    });
    appForm = {
      initial: initial?.result?.value ?? null,
      filtered: filtered?.result?.value ?? null,
      // The task list needs a live Pi runtime; in headless sessions the
      // connection can be unavailable, in which case the app must show the
      // graceful error state instead of a blank list.
      graceful: (initial?.result?.value?.cardCount ?? 0) > 0 ||
        (initial?.result?.value?.stateText ?? "").includes("运行时连接已断开") ||
        (initial?.result?.value?.stateText ?? "").includes("Task service"),
    };
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
      ["plugin-manager", `${sessionUrl}?app=core.pluginManager`],
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
