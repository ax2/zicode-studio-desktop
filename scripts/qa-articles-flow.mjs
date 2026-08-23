// Articles app local loop sweep: create a new article through the real UI
// (slug + markdown), save it, verify it appears in the list, delete it, and
// prove the host no longer serves it. Uses the real /v2/articles HTTP API,
// so no mock is needed; cleanup runs through the same UI delete path.
//
// Usage (app must be running on localhost):
//   node scripts/qa-articles-flow.mjs <workspaceId|folderName> [sessionId]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 8000);
const SCENE = "programming";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveWorkspaceId(host, projectPath) {
  try {
    const response = await fetch(`${host}/v2/resolve-workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectPath }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.workspaceId === "string" ? body.workspaceId : null;
  } catch {
    return null;
  }
}

async function discoverSessionId(host, workspaceId) {
  try {
    const response = await fetch(
      `${host}/v2/sessions?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    if (!response.ok) return null;
    const body = await response.json();
    const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
    if (sessions.length === 0) return null;
    const current = sessions.find((session) => session.isCurrentWorkspace);
    const sorted = [...sessions].sort(
      (left, right) =>
        (Number(right.modifiedAtMs) || 0) - (Number(left.modifiedAtMs) || 0),
    );
    return (current ?? sorted[0])?.id ?? null;
  } catch {
    return null;
  }
}

async function listArticles(host, workspaceId) {
  const response = await fetch(
    `${host}/v2/articles?sceneId=${SCENE}&workspaceId=${encodeURIComponent(workspaceId)}`,
  );
  if (!response.ok) return [];
  const body = await response.json();
  return Array.isArray(body?.articles) ? body.articles : [];
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
          const { res, rej } = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) rej(new Error(message.error.message));
          else res(message);
        }
      });
      resolve({ send, close: () => ws.close() });
    });
    ws.addEventListener("error", reject);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.result?.exceptionDetails) {
    throw new Error(
      result.result.exceptionDetails.exception?.description ??
        result.result.exceptionDetails.text,
    );
  }
  return result.result?.result?.value;
}

async function main() {
  const rawWs = process.argv[2] || process.env.ZICODE_WORKSPACE;
  let sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!rawWs) {
    console.error("Usage: node scripts/qa-articles-flow.mjs <workspaceId> <sessionId>");
    process.exit(2);
  }
  let workspaceId = rawWs;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawWs)) {
    const candidates = [rawWs];
    const workspacesRoot = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "zicode", "workspaces")
      : null;
    if (workspacesRoot && !/[\\/]/.test(rawWs)) {
      candidates.push(join(workspacesRoot, rawWs));
    }
    for (const candidate of candidates) {
      const resolved = await resolveWorkspaceId(HOST, candidate);
      if (resolved) {
        workspaceId = resolved;
        break;
      }
    }
    if (workspaceId === rawWs) {
      console.error(`Could not resolve workspace from "${rawWs}"`);
      process.exit(2);
    }
    console.log(`[qa-articles-flow] resolved workspace ${rawWs} -> ${workspaceId}`);
  }
  if (!sessionId) {
    sessionId = await discoverSessionId(HOST, workspaceId);
  }
  if (!sessionId) {
    console.error("Could not discover a session for this workspace");
    process.exit(2);
  }

  const beforeArticles = await listArticles(HOST, workspaceId);
  console.log(
    `[qa-articles-flow] baseline articles: ${beforeArticles.length}`,
  );
  const stamp = Date.now();
  const qaSlug = `qa-article-${stamp}`;
  const qaTitle = `QA 文章验收 ${stamp}`;

  const profile = mkdtempSync(join(tmpdir(), "zicode-articles-flow-"));
  const viewport = process.env.VIEWPORT;
  const [width, height] = viewport
    ? viewport.split("x").map(Number)
    : [1440, 900];
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
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );

  try {
    let debugPort = null;
    let target = null;
    for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
      await sleep(300);
      if (!debugPort) {
        try {
          debugPort = readFileSync(
            join(profile, "DevToolsActivePort"),
            "utf8",
          )
            .trim()
            .split("\n")[0];
        } catch {
          // Not ready yet.
        }
      }
      if (!debugPort) continue;
      try {
        const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(
          (response) => response.json(),
        );
        target = targets.find((candidate) => candidate.type === "page");
      } catch {
        // Not ready yet.
      }
    }
    if (!target) throw new Error("Could not discover a Chrome page target");

    const cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    if (viewport) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 768,
      });
    }
    const sessionUrl = `${HOST}/app/workspaces/${workspaceId}/sessions/${sessionId}?app=com.zicode.articles`;
    await cdp.send("Page.navigate", { url: sessionUrl });
    await sleep(WAIT_MS + 6000);

    const failures = [];

    const created = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const setValue = (el, value) => {
          const proto =
            el.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        const newBtn = document.querySelector(".articles-nav-new");
        if (!newBtn) return { error: "new-article button missing" };
        newBtn.click();
        await wait(600);
        const slugInput = document.querySelector('input[aria-label="Slug"], input[aria-label="链接标识"]');
        const textarea = document.querySelector(".articles-textarea");
        if (!slugInput || !textarea) {
          return { error: "editor fields missing", hasTextarea: Boolean(textarea) };
        }
        setValue(slugInput, ${JSON.stringify(qaSlug)});
        setValue(textarea, ${JSON.stringify(`# ${qaTitle}\n\nQA 验收正文。`)});
        const save = Array.from(document.querySelectorAll(".articles-actions button")).find(
          (button) => /Save|保存/.test(button.textContent || ""),
        );
        if (!save) return { error: "save button missing" };
        save.click();
        for (let i = 0; i < 80; i += 1) {
          const item = Array.from(document.querySelectorAll(".articles-item-title")).find(
            (node) =>
              (node.textContent || "").includes(${JSON.stringify(qaSlug)}) ||
              (node.textContent || "").includes(${JSON.stringify(qaTitle)}),
          );
          if (item) return { listed: true, title: item.textContent };
          await wait(300);
        }
        return { error: "article did not appear in list" };
      })()`,
    );
    if (!created.listed) {
      failures.push(`create: ${created.error ?? "not listed"}`);
    }
    console.log("CREATE:", JSON.stringify(created));

    const hostCreated = await listArticles(HOST, workspaceId);
    if (!hostCreated.some((article) => article.slug === qaSlug)) {
      failures.push("create: article missing from host API after save");
    }
    console.log("HOST:", JSON.stringify({ count: hostCreated.length, found: hostCreated.some((a) => a.slug === qaSlug) }));

    const deleted = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const del = Array.from(document.querySelectorAll(".articles-actions button")).find(
          (button) => /Delete|删除/.test(button.textContent || ""),
        );
        if (!del) return { error: "delete button missing" };
        del.click();
        for (let i = 0; i < 80; i += 1) {
          const remaining = Array.from(document.querySelectorAll(".articles-item-title")).some(
            (node) =>
              (node.textContent || "").includes(${JSON.stringify(qaSlug)}) ||
              (node.textContent || "").includes(${JSON.stringify(qaTitle)}),
          );
          if (!remaining) return { deleted: true };
          await wait(300);
        }
        return { error: "article still in list after delete" };
      })()`,
    );
    if (!deleted.deleted) {
      failures.push(`delete: ${deleted.error ?? "still listed"}`);
    }
    console.log("DELETE:", JSON.stringify(deleted));

    const afterArticles = await listArticles(HOST, workspaceId);
    const stillHosted = afterArticles.some((article) => article.slug === qaSlug);
    if (stillHosted) {
      failures.push("delete: article still served by host API");
    }
    console.log("AFTER:", JSON.stringify({ count: afterArticles.length, stillHosted }));

    if (failures.length > 0) {
      console.error(`ARTICLES FLOW SWEEP FAILED:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log("ARTICLES FLOW SWEEP: new -> save -> list -> delete loop passed");
    }
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Best effort cleanup.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
