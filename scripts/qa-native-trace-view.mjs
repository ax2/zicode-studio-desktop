// Drive a running isolated Windows Studio WebView2 instance through the real tool center.
// Usage: node scripts/qa-native-trace-view.mjs <CDP port> <screenshot directory>
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const port = Number(process.argv[2]);
const screenshotDir = process.argv[3] ? resolve(process.argv[3]) : null;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !screenshotDir) {
  throw new Error("Usage: node scripts/qa-native-trace-view.mjs <CDP port> <screenshot directory>");
}
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function connect(url) {
  return new Promise((done, fail) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let sequence = 0;
    socket.addEventListener("open", () => done({
      send(method, params = {}) {
        return new Promise((resolveCall, rejectCall) => {
          const id = ++sequence;
          pending.set(id, { resolveCall, rejectCall });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close() { socket.close(); },
    }));
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      if (message.error) task.rejectCall(new Error(message.error.message));
      else task.resolveCall(message.result);
    });
    socket.addEventListener("error", () => fail(new Error("WebView2 debugging socket failed")));
  });
}

async function until(check, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await check();
    if (value) return value;
    await pause(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page" && target.title === "ZiCode Studio Desktop");
  if (!page) throw new Error("Studio native WebView2 page not found");
  const cdp = await connect(page.webSocketDebuggerUrl);
  const evaluate = async (expression) => {
    const answer = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text);
    return answer.result.value;
  };
  const panel = () => evaluate("document.querySelector('.plugin-result-actions')?.innerText || ''");
  const click = (label, selector = "button") => evaluate(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(candidate => candidate.textContent.includes(${JSON.stringify(label)}));
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  async function capture(name, selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'}); true`);
    await pause(150);
    const image = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    mkdirSync(screenshotDir, { recursive: true });
    const path = join(screenshotDir, name);
    writeFileSync(path, Buffer.from(image.data, "base64"));
    return path;
  }
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    const native = await evaluate("!!window.__TAURI__?.core && location.search.includes('app=core.tools')");
    if (!native) throw new Error("Expected Studio native tool center");
    await until(() => evaluate("[...document.querySelectorAll('.tool-center-card h2')].some(item => item.textContent === 'Django / Python 堆栈')"), "Trace tool directory entry");
    const opened = await evaluate(`(() => {
      const card = [...document.querySelectorAll('.tool-center-card')]
        .find(item => item.querySelector('h2')?.textContent === 'Django / Python 堆栈');
      const button = [...card.querySelectorAll('button')].find(item => item.textContent.includes('打开工具'));
      button?.click(); return !!button;
    })()`);
    if (!opened) throw new Error("Trace tool could not be opened");
    await until(() => evaluate("!!document.querySelector('.manual-tool-directory .tool-input-field textarea')"), "loaded tool form");
    const sample = `Traceback (most recent call last):\n  File "app/views.py", line 15, in detail\ndjango.urls.exceptions.NoReverseMatch: missing URL`;
    await evaluate(`(() => {
      const input = document.querySelector('.manual-tool-directory .tool-input-field textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(sample)});
      input.dispatchEvent(new Event('input', { bubbles: true })); return true;
    })()`);
    await pause(100);
    if (!await click("执行工具", ".manual-tool-directory button")) throw new Error("Trace execute action missing");
    await until(() => evaluate("document.querySelector('textarea[aria-label=\"工具结果\"]')?.value.includes('NoReverseMatch') && document.body.innerText.includes('工具执行成功')"), "Trace worker result");
    const screenshots = [await capture("trace-native-result.png", "textarea[aria-label='工具结果']")];
    if (!await click("发送到工具", ".plugin-result-actions button")) throw new Error("Transfer action missing");
    await until(() => evaluate("[...document.querySelectorAll('.plugin-result-target-list button')].some(item => item.textContent.includes('JSON 格式化 · com.zicode.devtools.text'))"), "Text receiver discovery");
    if (!await click("JSON 格式化 · com.zicode.devtools.text", ".plugin-result-target-list button")) throw new Error("Receiver selection failed");
    await until(async () => (await panel()).includes("发送预览") && (await panel()).includes("NoReverseMatch"), "transfer preview");
    if (!await click("确认发送并执行", ".plugin-result-actions button")) throw new Error("Transfer confirmation missing");
    await until(async () => (await panel()).includes("接收工具处理结果") && (await panel()).includes("NoReverseMatch"), "receiver worker result");
    screenshots.push(await capture("trace-native-transfer.png", ".plugin-result-actions"));
    if (!await click("预览保存", ".plugin-result-actions button")) throw new Error("Save preview action missing");
    await until(async () => (await panel()).includes("保存预览") && (await panel()).includes("NoReverseMatch"), "save preview");
    if (!await click("确认保存", ".plugin-result-actions button")) throw new Error("Save confirmation missing");
    await until(async () => (await panel()).includes("已保存到当前工作区的交付物"), "saved artifact acknowledgement");
    if (!await evaluate("!!document.querySelector('.plugin-result-actions button')")) throw new Error("Saved artifact link missing");
    screenshots.push(await capture("trace-native-saved.png", ".plugin-result-actions"));
    process.stdout.write(`${JSON.stringify({ passed: true, nativeWebView2: true, traceDisplayed: true,
      receiverExecuted: true, savedAfterConfirmation: true, screenshots })}\n`);
  } finally {
    cdp.close();
  }
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
