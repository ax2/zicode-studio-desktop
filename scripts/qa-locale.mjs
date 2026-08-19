// English-locale UI leak sweep across every enabled desktop app view.
//
// Sets the en locale cookie, loads each view, and reports Han characters in
// UI chrome (buttons, labels, placeholders, aria-labels, headings). User
// content (chat transcripts, note/session titles, task cards, tool output)
// is excluded so the report contains only hardcoded Chinese UI strings that
// would leak into the English interface.
//
// Usage (app must be running on localhost):
//   node scripts/qa-locale.mjs <workspaceId> <sessionId>
//   APP_FILTER=notes node scripts/qa-locale.mjs <ws> <session>
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 6000);

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

async function main() {
  const wsId = process.argv[2] || process.env.ZICODE_WORKSPACE;
  const sessionId = process.argv[3] || process.env.ZICODE_SESSION;
  if (!wsId || !sessionId) {
    throw new Error(
      "Usage: node scripts/qa-locale.mjs <workspaceId> <sessionId>",
    );
  }

  const enabledPlugins = new Set();
  try {
    const response = await fetch(`${HOST}/v2/plugins?sceneId=programming`);
    if (response.ok) {
      const body = await response.json();
      for (const plugin of body.plugins ?? []) {
        if (plugin.enabled) enabledPlugins.add(plugin.id);
      }
    }
  } catch {
    // Plugin state is optional; walk everything when unavailable.
  }

  const sessionUrl = `${HOST}/app/workspaces/${wsId}/sessions/${sessionId}`;
  const candidates = [
    ["chat", `${sessionUrl}`],
    ["notes", `${sessionUrl}?app=com.zicode.notes`],
    ["tasks", `${sessionUrl}?app=com.zicode.tasks`],
    ["finance", `${sessionUrl}?app=com.zicode.finance`],
    ["translate", `${sessionUrl}?app=com.zicode.translate`],
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
  const apps = candidates.filter(([name, url]) => {
    if (filter && name !== filter) return false;
    if (enabledPlugins.size === 0) return true;
    const pluginId = new URL(url, HOST).searchParams.get("app");
    return !pluginId || pluginId.startsWith("core.") || enabledPlugins.has(pluginId);
  });

  const profile = mkdtempSync(join(tmpdir(), "zicode-locale-"));
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

    // Seed the English locale cookie on the host origin before any app load.
    await cdp.send("Page.navigate", { url: `${HOST}/` });
    await sleep(1500);
    await cdp.send("Runtime.evaluate", {
      expression: `document.cookie = "zicode-studio-locale=en; Path=/; SameSite=Lax"; true`,
    });

    const report = [];
    for (const [name, url] of apps) {
      await cdp.send("Page.navigate", { url });
      await sleep(WAIT_MS);
      const result = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const contentContainer = [
            ".messages", ".session-list", ".session-search-result",
            ".session-item", ".plugin-sidebar-surface",
            ".notes-tree", ".notes-list", ".notes-list-item",
            ".notes-notebook-branch", ".notes-result-list", ".trash-list",
            ".task-card", ".task-list", ".task-center-card", ".task-center-list",
            ".artifact-list", ".artifact-item",
            ".runtime-task-card", ".runtime-task-list", ".super-agent-runtime",
            ".plugin-manager-permission", ".plugin-manager-permissions",
            ".watch-item", ".habit-item", ".inbox-item", ".transcript",
            ".tool-output", ".chat-message", ".result-item", ".project-sessions",
            ".project-group", ".note-list-item", ".notes-nav-item",
          ].join(",");
          const chromeSelector = [
            "button", "[role=button]", "a", "[aria-label]", "[placeholder]",
            "[title]", "label", "h1", "h2", "h3", "th", ".activity-button",
            ".nav-item", ".menu-item", ".ui-button",
          ].join(",");
          const startupFailed = document.body?.classList.contains("startup-failed") ?? false;
          const leaks = [];
          for (const el of document.querySelectorAll(chromeSelector)) {
            if (el.closest(contentContainer)) continue;
            const label =
              el.getAttribute?.("aria-label") ||
              el.getAttribute?.("placeholder") ||
              el.getAttribute?.("title") ||
              el.textContent ||
              "";
            const text = label.replace(/\\s+/g, " ").trim();
            if (text && /[\\p{Script=Han}]/u.test(text)) leaks.push(text.slice(0, 80));
          }
          return {
            startupFailed,
            leaks: [...new Set(leaks)].slice(0, 30),
          };
        })()`,
        returnByValue: true,
      });
      const value = result?.result?.value ?? { startupFailed: false, leaks: [] };
      const pass = !value.startupFailed && value.leaks.length === 0;
      report.push({ name, ...value, pass });
      console.log(
        JSON.stringify({
          name,
          startupFailed: value.startupFailed,
          leaks: value.leaks ?? [],
          pass,
        }),
      );
    }

    const failures = report.filter((entry) => !entry.pass);

    // Live switch verification: change the language through the Settings UI,
    // assert the chrome flips to English, then restore Simplified Chinese.
    let switchResult = { ok: false, error: null };
    try {
      const settingsUrl = `${sessionUrl}?app=core.settings`;
      await cdp.send("Page.navigate", { url: settingsUrl });
      await sleep(WAIT_MS);
      const pickOption = async (labels) => {
        const candidates = Array.isArray(labels) ? labels : [labels];
        await cdp.send("Runtime.evaluate", {
          expression: `document.querySelector("#language-select")?.click(); true`,
        });
        await sleep(400);
        const clicked = await cdp.send("Runtime.evaluate", {
          expression: `(() => {
            const option = Array.from(document.querySelectorAll(".app-select-option"))
              .find((button) => ${JSON.stringify(candidates)}
                .includes(button.textContent.trim()));
            if (!option) return false;
            option.click();
            return true;
          })()`,
          returnByValue: true,
        });
        await sleep(1200);
        return clicked?.result?.value === true;
      };
      const switched = await pickOption(["英语", "English"]);
      if (!switched) {
        switchResult = { ok: false, error: "English option not found in the language menu" };
      } else {
        const english = await cdp.send("Runtime.evaluate", {
          expression: `/Appearance|Theme|Language/i.test(
            document.querySelector(".plugin-main-view")?.textContent ?? "",
          )`,
          returnByValue: true,
        });
        const cookie = await cdp.send("Runtime.evaluate", {
          expression: "document.cookie",
          returnByValue: true,
        });
        const localeSet =
          english?.result?.value === true &&
          /zicode-studio-locale=en/.test(String(cookie?.result?.value ?? ""));
        if (!localeSet) {
          switchResult = {
            ok: false,
            error: "settings did not flip the UI/cookie to English",
          };
        } else {
          const restored = await pickOption("简体中文");
          switchResult = {
            ok: restored,
            error: restored ? null : "could not restore Simplified Chinese",
          };
        }
      }
    } catch (error) {
      switchResult = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    console.log(
      JSON.stringify({
        switch: switchResult.ok
          ? { ok: true, note: "settings language switch → English and back works" }
          : switchResult,
      }),
    );
    console.log(
      `LOCALE SWEEP: ${report.length - failures.length}/${report.length} views clean` +
        (failures.length > 0
          ? ` (${failures.map((entry) => entry.name).join(", ")} have leaks)`
          : ""),
    );
    process.exitCode = failures.length > 0 || !switchResult.ok ? 1 : 0;
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; Chrome may still hold the profile on Windows.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
