#!/usr/bin/env node
// Artifacts display regression: creates a real artifact through the backend,
// opens the artifacts app in headless Chrome, verifies the item renders and
// its content opens, then deletes the artifact.
//
// Usage (app must be running on localhost):
//   node scripts/qa-artifacts-flow.mjs <workspaceId> <sessionId>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 4500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "evaluation failed",
    );
  }
  return response.result?.value;
}

async function main() {
  const wsId = process.argv[2] || process.env.ZICODE_WORKSPACE;
  const sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!wsId || !sessionId) {
    throw new Error(
      "Usage: node scripts/qa-artifacts-flow.mjs <workspaceId> <sessionId>",
    );
  }

  const createResponse = await fetch(`${HOST}/v2/artifacts/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: wsId,
      sceneId: "programming",
      pluginId: "com.zicode.finance",
      kind: "report",
      title: "QA 产物回归",
      summary: "自动化回归创建的测试产物",
      mimeType: "text/plain",
      provenance: [{ source: "qa-regression", id: "qa-1" }],
      content: "QA 产物内容",
    }),
  });
  if (!createResponse.ok) {
    throw new Error(`create artifact failed: ${createResponse.status}`);
  }
  const artifact = (await createResponse.json()).artifact;

  const profile = mkdtempSync(join(tmpdir(), "zicode-artifacts-"));
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
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const original = window.fetch;
        window.__qaArtifactFetch = [];
        window.fetch = async (...args) => {
          const url = String(args[0]);
          if (url.includes("/v2/artifacts")) {
            const response = await original(...args);
            window.__qaArtifactFetch.push({
              url,
              status: response.status,
              body: await response.clone().text().catch(() => ""),
            });
            return response;
          }
          return original(...args);
        };
      })()`,
    });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const url = `${HOST}/app/workspaces/${wsId}/sessions/${sessionId}?app=com.zicode.artifacts`;
    await cdp.send("Page.navigate", { url });
    await sleep(WAIT_MS);

    // Capture what the app actually loaded by reading its state UI.
    const state = await evaluate(
      cdp,
      `(() => ({
        navText: document
          .querySelector(".artifacts-nav-section")
          ?.textContent?.replace(/\\s+/g, " ")
          .trim() ?? "",
        mainText: document
          .querySelector(".artifacts-main, .plugin-main-view")
          ?.textContent?.replace(/\\s+/g, " ")
          .slice(0, 200) ?? "",
      }))()`,
    );
    const fetchLog = await evaluate(
      cdp,
      `(() => window.__qaArtifactFetch ?? [])()`,
    );

    const view = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const item = Array.from(
          document.querySelectorAll(".artifacts-list-item"),
        ).find((node) => (node.textContent || "").includes("QA 产物回归"));
        item?.click();
        await wait(1200);
        const items = Array.from(
          document.querySelectorAll(".artifacts-list-item"),
        ).map((node) => node.textContent?.replace(/\\s+/g, " ").trim() ?? "");
        const doc = document.querySelector(".artifacts-document");
        return {
          listHasArtifact: items.some((text) => text.includes("QA 产物回归")),
          documentOpened: Boolean(doc),
          contentShown: (doc?.textContent ?? "").includes("QA 产物内容"),
          metadataShown:
            (document.querySelector(".artifacts-metadata")?.textContent ?? "")
              .includes("Resource handle") ||
            (document.querySelector(".artifacts-metadata")?.textContent ?? "")
              .includes(${JSON.stringify(artifact.id.slice(0, 8))}) ||
            false,
        };
      })()`,
    );
    cdp.close();

    const report = {
      artifact: { id: artifact.id, title: artifact.title },
      fetchLog,
      view,
      pass:
        view.listHasArtifact &&
        view.documentOpened &&
        view.contentShown &&
        view.metadataShown,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
  } finally {
    chrome.kill();
    await sleep(300);
    try {
      await fetch(`${HOST}/v2/artifacts/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: wsId,
          sceneId: "programming",
          artifactId: artifact.id,
          expectedVersion: artifact.version ?? "",
        }),
      });
    } catch {
      // Cleanup is best-effort.
    }
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
