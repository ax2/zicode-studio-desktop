#!/usr/bin/env node
// Desktop UI performance baseline (run against the running app's CDP port).
//
// Usage: node scripts/bench-desktop-ui.mjs [--port 9226]
//
// Measures wall-clock latency for core interactions so regressions are caught
// early: session switch (real transcript render), notes tree + note open,
// command palette open, and session search. Prints timings in milliseconds.

import http from "node:http";

const portArgIndex = process.argv.indexOf("--port");
const port =
  portArgIndex >= 0 ? Number(process.argv[portArgIndex + 1]) : 9226;

function getTarget() {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}/json`, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const page = JSON.parse(body).find(
              (t) => t.type === "page" && t.url.includes("127.0.0.1:57620"),
            );
            if (!page) reject(new Error("No ZiCode page target on CDP"));
            else resolve(page);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

async function main() {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  await new Promise((resolve) => (ws.onopen = resolve));
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return r.exceptionDetails
      ? { __exception: r.exceptionDetails.text }
      : r.result?.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timed = async (label, fn) => {
    const start = await evalJs("performance.now()");
    await fn();
    const end = await evalJs("performance.now()");
    console.log(`${label}: ${Math.round(end - start)}ms`);
  };

  // Move to the home workspace (ax2) which holds real sessions and notebooks.
  await evalJs(`(() => { const b = document.getElementById("workspace-switcher-btn"); b && b.click(); })()`);
  await sleep(500);
  await evalJs(`(() => {
    const menu = document.querySelector(".workspace-switcher-menu");
    const item = [...menu.querySelectorAll("button")].find(
      (b) => (b.innerText || "").includes("C:\\\\Users\\\\ax2") && !(b.innerText || "").includes("zicode"),
    );
    if (item) item.click();
  })()`);
  await sleep(2200);

  // 1) Real session switch (transcript render)
  await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(x => x.title === "对话" || x.getAttribute("aria-label") === "对话"); b && b.click(); })()`);
  await sleep(800);
  await timed("session-switch-render", async () => {
    await evalJs(`(() => {
      const rows = [...document.querySelectorAll(".session-item")];
      const realRow = rows.find((r) => !/智能收件箱|Agent Inbox/.test(r.textContent || "")) || rows[1];
      if (realRow) realRow.click();
    })()`);
    for (let i = 0; i < 60; i++) {
      const ready = await evalJs(
        `!!(document.querySelector(".message") && document.querySelector(".message").offsetParent)`,
      );
      if (ready) break;
      await sleep(100);
    }
  });

  // 2) Notes tree + note open
  await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(x => x.title === "笔记" || x.getAttribute("aria-label") === "笔记"); b && b.click(); })()`);
  await sleep(1200);
  await timed("notes-tree-open", async () => {
    await evalJs(`(() => {
      const details = document.querySelector("details.notes-notebook-branch");
      if (details && !details.hasAttribute("open")) details.querySelector("summary")?.click();
    })()`);
    for (let i = 0; i < 30; i++) {
      const ready = await evalJs(
        `!!document.querySelector("details.notes-notebook-branch[open] .notes-list-item")`,
      );
      if (ready) break;
      await sleep(100);
    }
  });
  await timed("note-open", async () => {
    await evalJs(`(() => {
      const row = document.querySelector("details.notes-notebook-branch[open] .notes-list-item");
      if (row) row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    })()`);
    for (let i = 0; i < 30; i++) {
      const ready = await evalJs(
        `(() => { const main = document.querySelector(".main"); return /编辑|预览/.test(main ? main.innerText.slice(0, 150) : ""); })()`,
      );
      if (ready) break;
      await sleep(100);
    }
  });

  // 3) Command palette open
  await timed("command-palette-open", async () => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "P", code: "KeyP", modifiers: 2 | 8 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "P", code: "KeyP", modifiers: 2 | 8 });
    for (let i = 0; i < 30; i++) {
      const ready = await evalJs(
        `(() => { const pal = document.getElementById("command-palette"); return pal && !pal.classList.contains("hidden"); })()`,
      );
      if (ready) break;
      await sleep(50);
    }
  });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await sleep(300);

  // 4) Session search (Ctrl+K + query)
  await timed("session-search", async () => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", modifiers: 2 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", modifiers: 2 });
    await sleep(200);
    await evalJs(`(() => {
      const input = document.querySelector("#session-search-dialog-input, .session-search-dialog input");
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, "你好");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    })()`);
    for (let i = 0; i < 40; i++) {
      const ready = await evalJs(
        `(() => { const list = document.querySelector("#session-search-results, .session-search-results"); return list && list.children.length > 0; })()`,
      );
      if (ready) break;
      await sleep(100);
    }
  });

  ws.close();
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
