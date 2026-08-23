// LAN/relay QR sweep: the "Open on Mobile" button must be visible when the
// relay is available, open the QR modal, and render an actual QR image plus
// the pairing address. Verifies the desktop-to-mobile pairing entry point.
//
// Usage (app must be running on localhost):
//   node scripts/qa-lan-qr.mjs <workspaceId|folderName> [sessionId]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const HOST = process.env.ZICODE_HOST || "http://127.0.0.1:57620";
const WAIT_MS = Number(process.env.WAIT_MS || 10000);

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
    console.error("Usage: node scripts/qa-lan-qr.mjs <workspaceId> <sessionId>");
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
    console.log(`[qa-lan-qr] resolved workspace ${rawWs} -> ${workspaceId}`);
  }
  if (!sessionId) {
    sessionId = await discoverSessionId(HOST, workspaceId);
  }
  if (!sessionId) {
    console.error("Could not discover a session for this workspace");
    process.exit(2);
  }

  const viewport = process.env.VIEWPORT;
  const [width, height] = viewport
    ? viewport.split("x").map(Number)
    : [1440, 900];
  const mobile = width < 768;
  const profile = mkdtempSync(join(tmpdir(), "zicode-lan-qr-"));
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
    for (let attempt = 0; attempt < 100 && !target; attempt += 1) {
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
    const sessionUrl = `${HOST}/app/workspaces/${workspaceId}/sessions/${sessionId}`;
    await cdp.send("Page.navigate", { url: sessionUrl });
    await sleep(WAIT_MS + 6000);

    const result = await evaluate(
      cdp,
      `(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const btn = document.getElementById("lan-qr-btn");
        if (!btn) return { error: "lan-qr button missing" };
        const btnCount = document.querySelectorAll("#lan-qr-btn").length;
        let visible = false;
        for (let i = 0; i < 40; i += 1) {
          visible =
            !btn.classList.contains("hidden") &&
            getComputedStyle(btn).display !== "none" &&
            btn.getBoundingClientRect().height > 0;
          if (visible) break;
          await wait(200);
        }
        if (!visible) {
          return {
            buttonExists: true,
            buttonVisible: false,
            btnCount,
            btnHidden: btn.classList.contains("hidden"),
            btnDisplay: getComputedStyle(btn).display,
            mobileIntent: ${mobile},
          };
        }
        btn.click();
        const modal = document.getElementById("lan-qr-modal");
        const modalExists = Boolean(modal);
        let modalOpen = false;
        for (let i = 0; i < 15; i += 1) {
          modalOpen =
            Boolean(modal) &&
            !modal.classList.contains("hidden") &&
            getComputedStyle(modal).display !== "none";
          if (modalOpen) break;
          await wait(200);
        }
        const image = document.getElementById("lan-qr-image");
        const address = document.getElementById("lan-qr-address");
        let imageVisible = false;
        for (let i = 0; i < 40; i += 1) {
          imageVisible =
            Boolean(image) &&
            !image.classList.contains("hidden") &&
            Boolean(image.getAttribute("src"));
          if (imageVisible) break;
          await wait(200);
        }
        return {
          buttonExists: true,
          buttonVisible: true,
          modalOpen,
          imageVisible,
          modalExists,
          modalHidden: modal ? modal.classList.contains("hidden") : null,
          loadingStatus:
            document.getElementById("lan-qr-loading")?.textContent ?? null,
          imageSrcPrefix: image?.getAttribute("src")?.slice(0, 30) ?? null,
          addressVisible:
            address &&
            !address.classList.contains("hidden") &&
            (address.textContent || "").length > 0,
          addressSample: (address?.textContent || "").slice(0, 40),
        };
      })()`,
    );
    console.log("LANQR:", JSON.stringify(result));

    const failures = [];
    if (result.error || !result.buttonExists) {
      failures.push(result.error ?? "button missing");
    }
    if (mobile) {
      // On phones the QR is meant to be *scanned*, so the header button is
      // intentionally hidden by the mobile shell; only assert that.
      if (result.buttonVisible) {
        failures.push("mobile: lan-qr button should be hidden by design");
      }
    } else {
      if (result.buttonExists && !result.buttonVisible) {
        failures.push("lan-qr button not visible (relay unavailable?)");
      }
      if (!result.modalOpen) {
        failures.push("QR modal did not open");
      }
      if (!result.imageVisible) {
        failures.push("QR image did not render");
      }
      if (!result.addressVisible) {
        failures.push("pairing address not shown");
      }
    }

    // Relay routing: a freshly generated pairing link must redirect to the
    // app path with the pairingToken preserved.
    let relayCheck = {};
    try {
      const qrUrl = new URL(`${HOST}/v2/lan-qr`);
      qrUrl.searchParams.set("kind", "session");
      qrUrl.searchParams.set(
        "path",
        `/app/workspaces/${workspaceId}/sessions/${sessionId}`,
      );
      const qrResponse = await fetch(qrUrl);
      const qrBody = await qrResponse.json();
      const pairingUrl = typeof qrBody?.url === "string" ? qrBody.url : "";
      if (!pairingUrl) {
        relayCheck = { error: "no pairing URL generated" };
      } else {
        const routeResponse = await fetch(pairingUrl, { redirect: "manual" });
        const location = routeResponse.headers.get("location") ?? "";
        relayCheck = {
          status: routeResponse.status,
          redirect: routeResponse.status >= 300 && routeResponse.status < 400,
          locationHasAppPath: location.includes("/app/"),
          tokenPreserved: location.includes("pairingToken="),
          locationSample: location.slice(0, 90),
        };
      }
    } catch (error) {
      relayCheck = { error: String(error) };
    }
    console.log("RELAY:", JSON.stringify(relayCheck));

    if (!mobile) {
      if (relayCheck.error) {
        failures.push(`relay: ${relayCheck.error}`);
      } else if (!relayCheck.redirect || !relayCheck.locationHasAppPath || !relayCheck.tokenPreserved) {
        failures.push("relay: pairing link did not redirect to the app path with token");
      }
    }

    if (failures.length > 0) {
      console.error(`LAN QR SWEEP FAILED:\n- ${failures.join("\n- ")}`);
      process.exitCode = 1;
    } else {
      console.log(
        mobile
          ? "LAN QR SWEEP: mobile header hides the QR button by design"
          : "LAN QR SWEEP: button visible, modal opens, QR + address rendered, relay redirects with token",
      );
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
