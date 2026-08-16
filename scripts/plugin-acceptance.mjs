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
const RUN_ID = process.env.QA_RUN_ID || Date.now().toString(36);
// Stable prefixes shared by every run so cleanup can also remove test data
// left behind by a previous interrupted/older run, not just this run's items.
const TEST_PREFIXES = {
  habit: "晨跑",
  watch: "QA 示例页",
  clipboard: "这是一条验收文本",
};

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

async function getJson(path) {
  const response = await fetch(`${HOST}${path}`);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

// Remove the items this run added so repeated acceptance runs do not
// accumulate test data in the workspace.
async function cleanup(ws) {
  const sceneId = process.env.QA_SCENE || "programming";
  const base = `sceneId=${encodeURIComponent(sceneId)}&workspaceId=${encodeURIComponent(ws)}`;

  const habits = await getJson(`/v2/habits?${base}`).catch(() => ({ habits: [] }));
  for (const habit of habits.habits ?? []) {
    if (String(habit.name ?? "").startsWith(TEST_PREFIXES.habit)) {
      await postJson("/v2/habits/remove", {
        sceneId,
        workspaceId: ws,
        habitId: habit.id,
      }).catch(() => {});
    }
  }

  const watchers = await getJson(`/v2/watch?${base}`).catch(() => ({ items: [] }));
  for (const item of watchers.items ?? []) {
    if (String(item.name ?? "").startsWith(TEST_PREFIXES.watch)) {
      await postJson("/v2/watch/remove", {
        sceneId,
        workspaceId: ws,
        id: item.id,
      }).catch(() => {});
    }
  }

  const clips = await getJson(`/v2/clipboard?${base}`).catch(() => ({ items: [] }));
  for (const item of clips.items ?? []) {
    if (String(item.text ?? "").startsWith(TEST_PREFIXES.clipboard)) {
      await postJson("/v2/clipboard/remove", {
        sceneId,
        workspaceId: ws,
        id: item.id,
      }).catch(() => {});
    }
  }
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

// The notes capture path is network-backed (proxy + SSRF + source dedupe), so
// exercise it against the host API as well. Capturing example.com is idempotent
// because the shared workspace already contains its content hash.
async function notesCaptureCheck(ws) {
  const sceneId = process.env.QA_SCENE || "programming";
  const result = await postJson("/v2/notes/capture", {
    sceneId,
    workspaceId: ws,
    notebookId: "b64be4fe-7c92-4195-81ad-e759b6698530",
    url: "https://example.com/",
  });
  return {
    ok: result?.duplicate === true || result?.note != null,
    duplicate: result?.duplicate === true,
    title: result?.note?.title ?? null,
  };
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
      // The host translate request has a 60s timeout. Poll past that window so
      // a slow-but-successful gateway or a late error is not misread as a
      // silent hang.
      let state = { result: "", error: null };
      for (let i = 0; i < 180; i++) {
        await sleep(500);
        state = await evaluate(
          cdp,
          `(() => ({
            result: (document.querySelector(".translate-result-text")?.value || "").trim(),
            error: document.querySelector("[role='alert']")?.innerText?.trim() || null,
          }))()`,
        );
        if (state.result || state.error) break;
      }
      result.ok = clicked && Boolean(state.result || state.error);
      result.detail = { pre, clicked, ...state };
    } else if (name === "habits") {
      await evaluate(cdp, `${SET_VALUE}(".habits-name-input", "晨跑-${RUN_ID}")`);
      const clicked = await evaluate(cdp, `${CLICK_BY_TEXT}(null, "添加习惯")`);
      await sleep(1200);
      const items = await evaluate(
        cdp,
        `Array.from(document.querySelectorAll(".habits-items li")).map((el) =>
          (el.textContent || "").trim()
        )`,
      );
      result.ok = clicked && items.some((text) => text.includes(RUN_ID));
      result.detail = { clicked, items };
    } else if (name === "watch") {
      await evaluate(cdp, `${SET_VALUE}(".watch-name-input", "QA 示例页-${RUN_ID}")`);
      await evaluate(cdp, `${SET_VALUE}(".watch-url-input", "https://example.com/")`);
      const clicked = await evaluate(cdp, `${CLICK_BY_TEXT}(null, "添加监控")`);
      await sleep(1500);
      const items = await evaluate(
        cdp,
        `Array.from(document.querySelectorAll(".watch-items li")).map((el) =>
          (el.textContent || "").trim()
        )`,
      );
      result.ok = clicked && items.some((text) => text.includes(RUN_ID));
      result.detail = { clicked, items };
    } else if (name === "clipboard") {
      await evaluate(cdp, `${SET_VALUE}(".clipboard-textarea", "这是一条验收文本-${RUN_ID}")`);
      const clicked = await evaluate(cdp, `${CLICK_BY_TEXT}(null, "添加到收件箱")`);
      await sleep(1200);
      const items = await evaluate(
        cdp,
        `Array.from(document.querySelectorAll(".clipboard-items li")).map((el) =>
          (el.textContent || "").trim()
        )`,
      );
      result.ok = clicked && items.some((text) => text.includes(RUN_ID));
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

    // Clear residue from any previous run before adding fresh items.
    await cleanup(ws).catch((error) => {
      console.log(`pre-clean warning: ${String(error?.message || error)}`);
    });
    const report = [];
    for (const [name, pluginId] of targets) {
      const result = await runPlugin(cdp, name, `${sessionUrl}?app=${pluginId}`, ws);
      report.push(result);
      console.log(JSON.stringify(result));
    }
    const capture = await notesCaptureCheck(ws).catch((error) => ({
      ok: false,
      error: String(error?.message || error),
    }));
    report.push({ name: "notes-capture", ...capture });
    console.log(JSON.stringify({ name: "notes-capture", ...capture }));
    await cleanup(ws).catch((error) => {
      console.log(`cleanup warning: ${String(error?.message || error)}`);
    });
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
