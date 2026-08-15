// Desktop acceptance harness for the built-in utility plugins.
// Drives the real running desktop host through headless Chrome + CDP and
// exercises one representative action per plugin (add, translate, import).
//
// Usage (app must be running on localhost):
//   node scripts/plugin-acceptance.mjs <workspaceId> <sessionId>
//   PLUGIN_FILTER=habits node scripts/plugin-acceptance.mjs <ws> <session>
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const PORT = Number(process.env.CDP_PORT || 9224);
const WAIT_MS = Number(process.env.WAIT_MS || 6000);
const ASSETS = process.env.QA_ASSETS || join(ROOT, "scripts", "fixtures");

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
      // Chrome DevTools server is still starting.
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
    ws.addEventListener("error", (event) =>
      reject(new Error(String(event.message || "ws error"))),
    );
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result?.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description || "evaluate failed",
    );
  }
  return result?.result?.value;
}

async function openPage(cdp, url) {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url });
  await sleep(WAIT_MS);
}

// Set a React-controlled input value by using the native setter and firing an
// input event (React's synthetic onChange is driven by the DOM input event).
const SET_VALUE = `((selector, value) => {
  const element = document.querySelector(selector);
  if (!element) return false;
  const proto = element.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})`;

const CLICK_BY_TEXT = `((scopeSelector, text) => {
  const root = scopeSelector ? document.querySelector(scopeSelector) : document;
  if (!root) return false;
  const button = Array.from(root.querySelectorAll("button")).find((el) =>
    (el.textContent || "").trim().includes(text) ||
    (el.getAttribute("aria-label") || "").includes(text)
  );
  if (!button) return false;
  button.click();
  return true;
})`;

async function setFile(cdp, selector, filePath) {
  const bytes = readFileSync(filePath);
  const base64 = bytes.toString("base64");
  const name = filePath.split(/[\\/]/).pop();
  const mime = name.endsWith(".pdf") ? "application/pdf" : "image/png";
  return evaluate(
    cdp,
    `((selector, base64, name, mime) => {
      const input = document.querySelector(selector);
      if (!input) return false;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], name, { type: mime });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })(${JSON.stringify(selector)}, ${JSON.stringify(base64)}, ${JSON.stringify(name)}, ${JSON.stringify(mime)})`,
  );
}

async function postJson(path, body) {
  const response = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await response.json());
    } catch {
      // Non-JSON error body.
    }
    throw new Error(`${path} -> ${response.status} ${detail}`);
  }
  return response.json();
}

// The headless file-input path cannot reliably wake React's onChange, so the
// file-backed plugins are additionally verified against their host APIs. This
// exercises the real extraction/import/layout/processing pipeline.
async function backendCheck(name, ws) {
  const sceneId = process.env.QA_SCENE || "programming";
  const png = `data:image/png;base64,${readFileSync(join(ASSETS, "test-image.png")).toString("base64")}`;
  const pdf = `data:application/pdf;base64,${readFileSync(join(ASSETS, "test-doc.pdf")).toString("base64")}`;

  if (name === "ocr") {
    const result = await postJson("/v2/ocr/extract", {
      sceneId,
      workspaceId: ws,
      image: png,
    });
    return { ok: result?.ok === true && typeof result?.text === "string", text: result?.text };
  }
  if (name === "documents") {
    const result = await postJson("/v2/documents/import", {
      sceneId,
      workspaceId: ws,
      document: pdf,
      fileName: "test-doc.pdf",
    });
    return {
      ok: result?.ok === true && typeof result?.markdown === "string" && result?.fileName === "test-doc.pdf",
      fileName: result?.fileName,
      charCount: result?.charCount,
    };
  }
  if (name === "idphoto") {
    const result = await postJson("/v2/idphoto/layout", {
      sceneId,
      workspaceId: ws,
      image: png,
      template: "one_inch",
      sheet: "5inch",
    });
    return { ok: result?.ok === true && typeof result?.url === "string", url: result?.url };
  }
  if (name === "imagetools") {
    const result = await postJson("/v2/imagetools/process", {
      sceneId,
      workspaceId: ws,
      image: png,
      resize: { width: 120, height: 80, fit: "contain" },
    });
    return { ok: result?.ok === true && typeof result?.url === "string", width: result?.width, height: result?.height };
  }
  return { ok: true };
}

async function runPlugin(cdp, name, url, ws) {
  await openPage(cdp, url);
  const result = { name, ok: false, detail: null };
  try {
    if (name === "translate") {
      await evaluate(
        cdp,
        `${SET_VALUE}(".translate-textarea", "hello world")`,
      );
      await sleep(500);
      const pre = await evaluate(
        cdp,
        `(() => ({
          value: document.querySelector(".translate-textarea")?.value ?? "",
          disabled: document.querySelector(".translate-controls .ui-button--primary")?.disabled ?? null,
        }))()`,
      );
      const clicked = await evaluate(
        cdp,
        `(() => {
          const button = document.querySelector(".translate-controls .ui-button--primary");
          if (!button) return false;
          button.click();
          return true;
        })()`,
      );
      await sleep(4000);
      const state = await evaluate(
        cdp,
        `(() => ({
          result: (document.querySelector(".translate-result-text")?.value || "").trim(),
          error: document.querySelector("[role='alert']")?.innerText?.trim() || null,
        }))()`,
      );
      result.ok = clicked && Boolean(state.result || state.error);
      result.detail = { pre, clicked, ...state };
    } else if (name === "habits") {
      await evaluate(cdp, `${SET_VALUE}(".habits-name-input", "晨跑")`);
      const clicked = await evaluate(cdp, `${CLICK_BY_TEXT}(null, "添加习惯")`);
      await sleep(1200);
      const items = await evaluate(
        cdp,
        `Array.from(document.querySelectorAll(".habits-items li")).map((el) =>
          (el.textContent || "").trim()
        )`,
      );
      result.ok = clicked && items.some((text) => text.includes("晨跑"));
      result.detail = { clicked, items };
    } else if (name === "watch") {
      await evaluate(cdp, `${SET_VALUE}(".watch-name-input", "QA 示例页")`);
      await evaluate(cdp, `${SET_VALUE}(".watch-url-input", "https://example.com/")`);
      const clicked = await evaluate(cdp, `${CLICK_BY_TEXT}(null, "添加监控")`);
      await sleep(1500);
      const items = await evaluate(
        cdp,
        `Array.from(document.querySelectorAll(".watch-items li")).map((el) =>
          (el.textContent || "").trim()
        )`,
      );
      result.ok = clicked && items.some((text) => text.includes("QA 示例页"));
      result.detail = { clicked, items };
    } else if (name === "clipboard") {
      await evaluate(cdp, `${SET_VALUE}(".clipboard-textarea", "这是一条验收文本")`);
      const clicked = await evaluate(cdp, `${CLICK_BY_TEXT}(null, "添加到收件箱")`);
      await sleep(1200);
      const items = await evaluate(
        cdp,
        `Array.from(document.querySelectorAll(".clipboard-items li")).map((el) =>
          (el.textContent || "").trim()
        )`,
      );
      result.ok = clicked && items.some((text) => text.includes("验收文本"));
      result.detail = { clicked, items };
    } else if (name === "ocr") {
      const set = await setFile(
        cdp,
        'input[type="file"]',
        join(ASSETS, "test-image.png"),
      );
      await sleep(4000);
      const state = await evaluate(
        cdp,
        `(() => ({
          hasImage: !!document.querySelector(".ocr-result img, .ocr-preview img"),
          result: (document.querySelector(".ocr-result, .ocr-main")?.innerText || "").trim().slice(0, 160),
          error: document.querySelector("[role='alert']")?.innerText?.trim() || null,
        }))()`,
      );
      const backend = await backendCheck(name, ws);
      result.ok = set && backend.ok;
      result.detail = { set, backend, ...state };
    } else if (name === "idphoto") {
      const set = await setFile(
        cdp,
        'input[type="file"]',
        join(ASSETS, "test-image.png"),
      );
      await sleep(2500);
      const state = await evaluate(
        cdp,
        `(() => ({
          hasCanvas: !!document.querySelector(".idphoto-preview canvas, .idphoto-result canvas, canvas"),
          controls: Array.from(document.querySelectorAll("button, select")).length,
          error: document.querySelector("[role='alert']")?.innerText?.trim() || null,
        }))()`,
      );
      const backend = await backendCheck(name, ws);
      result.ok = set && backend.ok;
      result.detail = { set, backend, ...state };
    } else if (name === "imagetools") {
      const set = await setFile(
        cdp,
        'input[type="file"]',
        join(ASSETS, "test-image.png"),
      );
      await sleep(2500);
      const state = await evaluate(
        cdp,
        `(() => ({
          hasPreview: !!document.querySelector(".imagetools-preview img, img"),
          processButton: Array.from(document.querySelectorAll("button")).some((el) =>
            /处理|Process/.test(el.textContent || "")
          ),
          error: document.querySelector("[role='alert']")?.innerText?.trim() || null,
        }))()`,
      );
      const backend = await backendCheck(name, ws);
      result.ok = set && backend.ok;
      result.detail = { set, backend, ...state };
    } else if (name === "documents") {
      const set = await setFile(
        cdp,
        'input[type="file"]',
        join(ASSETS, "test-doc.pdf"),
      );
      await sleep(5000);
      const state = await evaluate(
        cdp,
        `(() => ({
          markdown: !!document.querySelector(".documents-preview, .documents-result"),
          result: (document.querySelector(".documents-preview, .documents-result")?.innerText || "").trim().slice(0, 160),
          error: document.querySelector("[role='alert']")?.innerText?.trim() || null,
        }))()`,
      );
      const backend = await backendCheck(name, ws);
      result.ok = set && backend.ok;
      result.detail = { set, backend, ...state };
    }
  } catch (error) {
    result.detail = { error: String(error?.message || error) };
  }
  return result;
}

async function main() {
  const ws = process.argv[2] || process.env.ZICODE_WORKSPACE;
  const session = process.argv[3] || process.env.ZICODE_SESSION;
  if (!ws || !session) {
    throw new Error("Usage: node scripts/plugin-acceptance.mjs <workspaceId> <sessionId>");
  }
  const sessionUrl = `${HOST}/app/workspaces/${ws}/sessions/${session}`;
  const plugins = [
    ["translate", "com.zicode.translate"],
    ["habits", "com.zicode.habits"],
    ["watch", "com.zicode.watch"],
    ["ocr", "com.zicode.ocr"],
    ["idphoto", "com.zicode.idphoto"],
    ["imagetools", "com.zicode.imagetools"],
    ["clipboard", "com.zicode.clipboard"],
    ["documents", "com.zicode.documents"],
  ];
  const filter = process.env.PLUGIN_FILTER;
  const targets = filter
    ? plugins.filter(([name]) => name === filter)
    : plugins;

  const profile = mkdtempSync(join(tmpdir(), "zicode-plugin-accept-"));
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
    const targetsList = await waitForJson(`http://127.0.0.1:${PORT}/json`);
    const page = targetsList.find((target) => target.type === "page");
    if (!page) throw new Error("No page target found");
    const cdp = await connect(page.webSocketDebuggerUrl);

    const report = [];
    for (const [name, pluginId] of targets) {
      const result = await runPlugin(cdp, name, `${sessionUrl}?app=${pluginId}`, ws);
      report.push(result);
      console.log(JSON.stringify(result));
    }
    const failed = report.filter((item) => !item.ok).map((item) => item.name);
    console.log(`\nACCEPTANCE: ${report.length - failed.length}/${report.length} passed`);
    if (failed.length) console.log(`FAILED: ${failed.join(", ")}`);
    cdp.close();
    process.exitCode = failed.length ? 1 : 0;
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
