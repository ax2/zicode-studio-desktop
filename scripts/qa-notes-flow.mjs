#!/usr/bin/env node
// Interaction-level regression for the Notes app against the live desktop
// backend. Exercises the exact flows users reported broken at various points:
// edit content, add tags, change the note icon, autosave, and persistence
// across a reload.
//
// Usage (app must be running on localhost):
//   node scripts/qa-notes-flow.mjs <workspaceId> <sessionId>
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 4000);

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
        "evaluation failed" + JSON.stringify(response.exceptionDetails).slice(0, 800),
    );
  }
  return response.result?.value;
}

async function main() {
  const wsId = process.argv[2] || process.env.ZICODE_WORKSPACE;
  const sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!wsId || !sessionId) {
    throw new Error("Usage: node scripts/qa-notes-flow.mjs <workspaceId> <sessionId>");
  }
  const scene = "programming";

  // Seed a notebook + note through the real notes API so the UI flow starts
  // from a known state, then clean both up at the end.
  const notebookResponse = await fetch(`${HOST}/v2/notes/notebooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: wsId,
      sceneId: scene,
      title: "__qa_flow_src__",
      icon: "📒",
    }),
  });
  if (!notebookResponse.ok) {
    throw new Error(`create notebook failed: ${notebookResponse.status}`);
  }
  const notebook = (await notebookResponse.json()).notebook;

  const targetNotebookResponse = await fetch(`${HOST}/v2/notes/notebooks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: wsId,
      sceneId: scene,
      title: "__qa_flow_tgt__",
      icon: "🗂️",
      parentId: notebook.id,
    }),
  });
  if (!targetNotebookResponse.ok) {
    throw new Error(`create target notebook failed: ${targetNotebookResponse.status}`);
  }
  const targetNotebook = (await targetNotebookResponse.json()).notebook;

  const noteResponse = await fetch(`${HOST}/v2/notes/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: wsId,
      sceneId: scene,
      notebookId: notebook.id,
      title: "__qa_flow_note__",
      content: "初始内容\n\n第二行",
      tags: ["seed"],
      icon: "📝",
    }),
  });
  if (!noteResponse.ok) {
    throw new Error(`create note failed: ${noteResponse.status}`);
  }
  const note = (await noteResponse.json()).note;

  const profile = mkdtempSync(join(tmpdir(), "zicode-qa-notes-"));
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
          const activePort = (
            await import("node:fs/promises")
          ).readFile(join(profile, "DevToolsActivePort"), "utf8");
          debugPort = (await activePort).trim().split("\n")[0];
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
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const url = `${HOST}/app/workspaces/${wsId}/sessions/${sessionId}?app=com.zicode.notes`;
    await cdp.send("Page.navigate", { url });
    await sleep(WAIT_MS);

    const openResult = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        // Expand the seeded notebook and open the seeded note.
        const branch = Array.from(document.querySelectorAll(".notes-notebook-branch")).find(
          (node) => (node.textContent || "").includes("__qa_flow_src__"),
        );
        if (branch && !branch.open) branch.querySelector("summary")?.click();
        await wait(600);
        const item = Array.from(document.querySelectorAll(".notes-tree-note")).find(
          (node) => (node.textContent || "").includes("__qa_flow_note__"),
        );
        item?.click();
        await wait(900);
        const editor = document.querySelector(".notes-editor");
        const parentBranch = document.querySelector(
          '.notes-notebook-branch[data-notebook-id="${notebook.id}"]',
        );
        const childNested = Boolean(
          parentBranch?.querySelector(
            '.notes-notebook-children .notes-notebook-branch[data-notebook-id="${targetNotebook.id}"]',
          ),
        );
        return {
          opened: !!editor,
          childNested,
          editTab: !!document.querySelector(".notes-edit-tab"),
          previewTab: !!document.querySelector(".notes-preview-tab"),
          title: document.querySelector(".notes-title-input")?.value ?? null,
          icon: document.querySelector(".notes-icon-input")?.value ?? null,
          tags: Array.from(document.querySelectorAll(".notes-tag-chip-name")).map(
            (node) => node.textContent,
          ),
        };
      })()`,
    );

    // Switch to edit mode and drive title, content, icon and tag changes.
    const editResult = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.querySelector(".notes-edit-tab")?.click();
        await wait(500);
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
        const title = document.querySelector(".notes-title-input");
        const icon = document.querySelector(".notes-icon-input");
        const content = document.querySelector(".notes-content-input");
        const tagInput = document.querySelector(".notes-tag-input");
        setValue(title, "QA 交互标题 已改");
        setValue(icon, "⭐");
        setValue(content, "# 大标题\\n\\n正文段落 **加粗** 内容\\n\\n- 列表项一\\n- 列表项二\\n\\n> 引用行");
        setValue(tagInput, "qa-flow");
        tagInput.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
        await wait(300);
        const saveState = document.querySelector(".notes-save-state")?.textContent ?? "";
        const dirty = document.querySelector(".notes-save-state")?.dataset.saveState;
        return {
          saveState,
          dirty,
          title: title?.value ?? null,
          icon: icon?.value ?? null,
          tags: Array.from(document.querySelectorAll(".notes-tag-chip-name")).map(
            (node) => node.textContent,
          ),
          contentLength: content?.value.length ?? 0,
        };
      })()`,
    );

    // Wait for the 2.5s autosave, then confirm the save indicator settles.
    await sleep(4000);
    const afterAutosave = await evaluate(
      cdp,
      `(() => ({
        saveState: document.querySelector(".notes-save-state")?.textContent ?? "",
        dirty: document.querySelector(".notes-save-state")?.dataset.saveState ?? null,
        title: document.querySelector(".notes-title-input")?.value ?? null,
        icon: document.querySelector(".notes-icon-input")?.value ?? null,
        tags: Array.from(document.querySelectorAll(".notes-tag-chip-name")).map(
          (node) => node.textContent,
        ),
      }))()`,
    );

    // Reload and re-open the note; the seeded content must now include every
    // change that the autosave persisted.
    await cdp.send("Page.reload", { ignoreCache: true });
    await sleep(WAIT_MS);
    const reloadResult = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const branch = Array.from(document.querySelectorAll(".notes-notebook-branch")).find(
          (node) => (node.textContent || "").includes("__qa_flow_src__"),
        );
        if (branch && !branch.open) branch.querySelector("summary")?.click();
        await wait(600);
        const item = Array.from(document.querySelectorAll(".notes-tree-note")).find(
          (node) => (node.textContent || "").includes("QA 交互标题"),
        );
        item?.click();
        await wait(900);
        document.querySelector(".notes-edit-tab")?.click();
        await wait(400);
        return {
          opened: !!document.querySelector(".notes-editor"),
          title: document.querySelector(".notes-title-input")?.value ?? null,
          icon: document.querySelector(".notes-icon-input")?.value ?? null,
          content: document.querySelector(".notes-content-input")?.value ?? null,
          tags: Array.from(document.querySelectorAll(".notes-tag-chip-name")).map(
            (node) => node.textContent,
          ),
        };
      })()`,
    );

    // Preview must render the markdown (headings, bold, list, blockquote).
    const previewResult = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.querySelector(".notes-preview-tab")?.click();
        await wait(700);
        const preview = document.querySelector(".notes-preview");
        return {
          hasPreview: !!preview,
          hasHeading: !!preview?.querySelector("h1"),
          hasBold: !!preview?.querySelector("strong"),
          hasList: !!preview?.querySelector("ul li"),
          hasQuote: !!preview?.querySelector("blockquote"),
          text: preview?.textContent?.slice(0, 80) ?? "",
        };
      })()`,
    );

    // "Discuss in Chat" with a text selection must carry only the selected
    // text into the composer, not the whole note.
    const discussResult = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        document.querySelector(".notes-edit-tab")?.click();
        await wait(400);
        const textarea = document.querySelector(".notes-content-input");
        const content = textarea?.value ?? "";
        const start = content.indexOf("正文段落");
        const selected = "正文段落 **加粗** 内容";
        if (start >= 0) {
          textarea.focus();
          textarea.setSelectionRange(start, start + selected.length);
        }
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        await wait(1800);
        const chatInput = document.querySelector("#chat-form textarea");
        const value = chatInput?.value ?? "";
        return {
          chatActive: document.body.dataset.activePlugin ?? null,
          inputValue: value,
          hasSelection: value.includes(selected),
          hasWholeNote: value.includes("# 大标题"),
          selectionApplied: start >= 0,
        };
      })()`,
    );

    // "Discuss in Chat" switched to Chat; return to Notes for the remaining
    // sidebar/filter checks.
    await evaluate(
      cdp,
      `(() => {
        document.querySelector('[data-plugin-id="com.zicode.notes"]')?.click();
        return true;
      })()`,
    );
    await sleep(1500);

    // Click the tag in the sidebar; the results list must filter to notes
    // carrying that tag (previously reported as broken).
    const tagFilterResult = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const tagButton = Array.from(
          document.querySelectorAll(".notes-nav-button"),
        ).find(
          (node) =>
            (node.textContent || "").includes("qa-flow"),
        );
        tagButton?.click();
        await wait(1200);
        const active = document
          .querySelector(".notes-nav-button.active")
          ?.textContent ?? "";
        const results = Array.from(
          document.querySelectorAll(".notes-result-item strong"),
        ).map((node) => node.textContent);
        const treeNotes = Array.from(
          document.querySelectorAll(".notes-tree-note"),
        ).map((node) => node.textContent || "");
        return {
          active,
          results,
          treeIncludesFlow: treeNotes.some((text) => text.includes("QA 交互标题")),
        };
      })()`,
    );

    // Drag the note from the source notebook onto the target notebook row.
    // This exercises the pointer-event drag/drop that was reported broken.
    const dragResult = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        // Reset to the full library so the notebook tree is visible.
        const allNotes = Array.from(
          document.querySelectorAll(".notes-nav-button"),
        ).find((node) => (node.textContent || "").includes("全部笔记"));
        allNotes?.click();
        await wait(900);
        const sourceBranch = Array.from(
          document.querySelectorAll(".notes-notebook-branch"),
        ).find((node) => (node.textContent || "").includes("__qa_flow_src__"));
        if (sourceBranch && !sourceBranch.open) {
          sourceBranch.querySelector("summary")?.click();
        }
        await wait(600);
        const noteRow = Array.from(
          document.querySelectorAll(".notes-tree-note"),
        ).find((node) => (node.textContent || "").includes("QA 交互标题"));
        const targetSummary = Array.from(
          document.querySelectorAll(".notes-notebook-summary"),
        ).find((node) =>
          (node.closest(".notes-notebook-branch")?.dataset?.notebookId || "") === "__qa_flow_tgt__" ||
          (node.textContent || "").includes("__qa_flow_tgt__"),
        );
        if (!noteRow || !targetSummary) {
          return {
            found: Boolean(noteRow && targetSummary),
            noteRow: Boolean(noteRow),
            targetSummary: Boolean(targetSummary),
          };
        }
        const noteRect = noteRow.getBoundingClientRect();
        const startX = noteRect.left + noteRect.width / 2;
        const startY = noteRect.top + noteRect.height / 2;
        noteRow.dispatchEvent(
          new PointerEvent("pointerdown", {
            clientX: startX,
            clientY: startY,
            button: 0,
            pointerId: 1,
            bubbles: true,
            cancelable: true,
          }),
        );
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: startX + 40,
            clientY: startY,
            pointerId: 1,
            bubbles: true,
          }),
        );
        await wait(250);
        const targetRect = targetSummary.getBoundingClientRect();
        const dropX = targetRect.left + Math.min(30, targetRect.width / 2);
        const dropY = targetRect.top + Math.max(4, targetRect.height / 2);
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: dropX,
            clientY: dropY,
            pointerId: 1,
            bubbles: true,
          }),
        );
        await wait(250);
        document.dispatchEvent(
          new PointerEvent("pointerup", {
            clientX: dropX,
            clientY: dropY,
            pointerId: 1,
            bubbles: true,
          }),
        );
        await wait(1800);
        return { found: true, noteRow: true, targetSummary: true, dropped: true };
      })()`,
    );

    // Verify through the backend that the note actually moved notebooks.
    let movedToTarget = false;
    try {
      const listResponse = await fetch(
        `${HOST}/v2/notes?workspaceId=${wsId}&sceneId=${scene}&query=${encodeURIComponent("QA 交互标题")}`,
      );
      const listBody = await listResponse.json();
      const movedNote = (listBody?.snapshot?.notes || []).find((entry) =>
        (entry.title || "").includes("QA 交互标题"),
      );
      movedToTarget = movedNote?.notebookId === targetNotebook.id;
    } catch {
      movedToTarget = false;
    }

    cdp.close();

    const report = {
      open: openResult,
      edited: editResult,
      afterAutosave,
      reload: reloadResult,
      preview: previewResult,
      discuss: discussResult,
      tagFilter: tagFilterResult,
      drag: { ...dragResult, movedToTarget },
      pass:
        openResult.childNested &&
        afterAutosave.title === "QA 交互标题 已改" &&
        afterAutosave.icon === "⭐" &&
        afterAutosave.tags.includes("qa-flow") &&
        reloadResult.title === "QA 交互标题 已改" &&
        reloadResult.icon === "⭐" &&
        reloadResult.tags.includes("qa-flow") &&
        reloadResult.content?.includes("# 大标题") &&
        previewResult.hasHeading &&
        previewResult.hasBold &&
        previewResult.hasList &&
        previewResult.hasQuote &&
        discussResult.selectionApplied &&
        discussResult.chatActive === "core.chat" &&
        discussResult.hasSelection &&
        !discussResult.hasWholeNote &&
        tagFilterResult.active.includes("qa-flow") &&
        tagFilterResult.results.some((title) => title.includes("QA 交互标题")) &&
        dragResult.found &&
        movedToTarget,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
  } finally {
    chrome.kill();
    await sleep(300);
    // Best-effort cleanup of the seeded data.
    try {
      // The note may have moved notebooks during the drag scenario, so
      // resolve its current location before deleting it.
      const listResponse = await fetch(
        `${HOST}/v2/notes?workspaceId=${wsId}&sceneId=${scene}&query=${encodeURIComponent("QA 交互标题")}`,
      );
      const listBody = await listResponse.json();
      const currentNote = (listBody?.snapshot?.notes || []).find((entry) =>
        (entry.title || "").includes("QA 交互标题"),
      );
      if (currentNote?.id && currentNote?.notebookId) {
        const noteBody = JSON.stringify({
          workspaceId: wsId,
          sceneId: scene,
          notebookId: currentNote.notebookId,
          noteId: currentNote.id,
          expectedVersion: currentNote.version ?? "",
        });
        await fetch(`${HOST}/v2/notes/delete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: noteBody,
        });
      }
      for (const notebookId of [notebook.id, targetNotebook.id]) {
        const nbBody = JSON.stringify({
          workspaceId: wsId,
          sceneId: scene,
          notebookId,
        });
        await fetch(`${HOST}/v2/notes/notebooks/delete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: nbBody,
        });
      }
    } catch {
      // Cleanup is best-effort; the seeded note is harmless if it remains.
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
