#!/usr/bin/env node
// Mobile attachment regression for the Notes app: uploads a text attachment
// through the real backend, opens the note in a phone-sized viewport, clicks
// the attachment link and verifies the in-app viewer shows the text content.
//
// Usage (app must be running on localhost):
//   node scripts/qa-notes-attachment.mjs <workspaceId> <sessionId>
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
      "Usage: node scripts/qa-notes-attachment.mjs <workspaceId> <sessionId>",
    );
  }
  const scene = "programming";

  const notebookResponse = await fetch(`${HOST}/v2/notes/notebooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: wsId,
      sceneId: scene,
      title: "__qa_attach__",
      icon: "📎",
    }),
  });
  if (!notebookResponse.ok) {
    throw new Error(`create notebook failed: ${notebookResponse.status}`);
  }
  const notebook = (await notebookResponse.json()).notebook;

  const noteResponse = await fetch(`${HOST}/v2/notes/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: wsId,
      sceneId: scene,
      notebookId: notebook.id,
      title: "__qa_attach_note__",
      content: "正文\n\n[查看附件 placeholder](/attachments/placeholder.txt)",
      tags: [],
      icon: "📝",
    }),
  });
  if (!noteResponse.ok) {
    throw new Error(`create note failed: ${noteResponse.status}`);
  }
  const note = (await noteResponse.json()).note;

  const attachmentBody = JSON.stringify({
    workspaceId: wsId,
    sceneId: scene,
    notebookId: notebook.id,
    noteId: note.id,
    fileName: "mobile-notes.txt",
    mimeType: "text/plain",
    dataBase64: Buffer.from("附件正文内容 mobile attachment").toString("base64"),
  });
  const attachmentResponse = await fetch(`${HOST}/v2/notes/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: attachmentBody,
  });
  if (!attachmentResponse.ok) {
    throw new Error(`upload attachment failed: ${attachmentResponse.status}`);
  }
  const attachment = (await attachmentResponse.json()).attachment;
  const attachmentPath = `/attachments/${note.id}/${attachment.id}`;

  // Point the note body at the real attachment path so the preview renders
  // the clickable attachment link.
  const saveResponse = await fetch(`${HOST}/v2/notes/save`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: wsId,
      sceneId: scene,
      notebookId: notebook.id,
      noteId: note.id,
      title: note.title,
      content: `正文\n\n[查看附件](${attachmentPath})`,
      tags: [],
      icon: note.icon,
      expectedVersion: note.version,
    }),
  });
  if (!saveResponse.ok) {
    throw new Error(`save note failed: ${saveResponse.status}`);
  }

  const profile = mkdtempSync(join(tmpdir(), "zicode-qa-attach-"));
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
          const fs = await import("node:fs/promises");
          debugPort = (await fs.readFile(join(profile, "DevToolsActivePort"), "utf8"))
            .trim()
            .split("\n")[0];
        } catch {
          // Not ready yet.
        }
      }
      if (!debugPort) continue;
      try {
        const targets = await waitForJson(
          `http://127.0.0.1:${debugPort}/json`,
          2000,
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
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });

    const url = `${HOST}/app/workspaces/${wsId}/sessions/${sessionId}?app=com.zicode.notes`;
    await cdp.send("Page.navigate", { url });
    await sleep(WAIT_MS);

    const result = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const branch = Array.from(document.querySelectorAll(".notes-notebook-branch")).find(
          (node) => (node.textContent || "").includes("__qa_attach__"),
        );
        if (branch && !branch.open) branch.querySelector("summary")?.click();
        await wait(600);
        const item = Array.from(document.querySelectorAll(".notes-tree-note")).find(
          (node) => (node.textContent || "").includes("__qa_attach_note__"),
        );
        item?.click();
        await wait(900);
        const link = document.querySelector(".notes-attachment-link");
        if (!link) {
          return { linkRendered: false };
        }
        const href = link.getAttribute("href");
        const isMobileShell = !!document.querySelector(".plugin-mobile-activity-more");
        link.click();
        await wait(900);
        const overlay = document.querySelector(".attachment-viewer-overlay");
        return {
          linkRendered: true,
          isMobileShell,
          href,
          overlayOpen: overlay?.classList.contains("open") ?? false,
          overlayTitle:
            overlay?.querySelector(".attachment-viewer-name")?.textContent ?? "",
          overlayText: overlay?.querySelector(".attachment-viewer-body")?.textContent ?? "",
        };
      })()`,
    );

    // Verify the real attachment endpoint serves the uploaded bytes.
    let served = null;
    try {
      const v2Url = new URL(`${HOST}/v2/notes/attachment`);
      v2Url.searchParams.set("sceneId", scene);
      v2Url.searchParams.set("workspaceId", wsId);
      v2Url.searchParams.set("notebookId", notebook.id);
      v2Url.searchParams.set("noteId", note.id);
      v2Url.searchParams.set("attachmentId", attachment.id);
      const response = await fetch(v2Url);
      served = {
        ok: response.ok,
        text: response.ok ? (await response.text()).trim() : "",
      };
    } catch {
      served = { ok: false, text: "" };
    }

    cdp.close();

    const report = {
      attachment: { id: attachment.id, path: attachmentPath },
      ui: result,
      served,
      pass:
        result.linkRendered === true &&
        result.isMobileShell === true &&
        result.overlayOpen === true &&
        (result.href || "").includes("/v2/notes/attachment") &&
        (result.href || "").includes(encodeURIComponent(attachment.id)) &&
        (result.overlayText || "").includes("附件正文内容") &&
        served.ok === true &&
        served.text === "附件正文内容 mobile attachment",
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
  } finally {
    chrome.kill();
    await sleep(300);
    try {
      const noteBody = JSON.stringify({
        workspaceId: wsId,
        sceneId: scene,
        notebookId: notebook.id,
        noteId: note.id,
        expectedVersion: note.version ?? "",
      });
      await fetch(`${HOST}/v2/notes/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: noteBody,
      });
      const nbBody = JSON.stringify({
        workspaceId: wsId,
        sceneId: scene,
        notebookId: notebook.id,
      });
      await fetch(`${HOST}/v2/notes/notebooks/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: nbBody,
      });
    } catch {
      // Best-effort cleanup.
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
