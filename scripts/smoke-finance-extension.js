import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { smokeRuntimeEnvironment } from "./smoke-runtime-environment.js";

const root = resolve(import.meta.dir, "..");
const binary = join(
  root,
  "src-tauri",
  "resources",
  "pi",
  process.platform === "win32" ? "pi.exe" : "pi",
);
const extension = join(root, "extensions", "dist", "picot-bridge.mjs");
const inbox = process.argv.includes("--inbox");
const scene = inbox ? "development" : "finance";
const extraExtensions = inbox ? ["--extension", join(root, "extensions", "dist", "pi-chat.mjs")] : [];
const temp = await mkdtemp(join(tmpdir(), "zicode-finance-smoke-"));
await writeFile(join(temp, "auth.json"), "{}");
let validInvocations = 0;
let rejectedInvocations = 0;
let incompleteInvocations = 0;
const brokerServer = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const body = await request.json().catch(() => null);
    if (new URL(request.url).pathname !== "/v2/plugin-tools/invoke" || request.method !== "POST"
      || request.headers.get("Authorization") !== "Bearer local-fixture-only"
      || body?.runtimeId !== "smoke-runtime" || body?.sessionId !== "smoke-session"
      || !["smoke-call", "missing-result"].includes(body?.toolCallId) || body?.toolName !== "smoke_plugin_tool"
      || body?.input?.message !== "roundtrip") {
      rejectedInvocations += 1;
      return Response.json({ error: { code: "fixture_rejected", message: "Unexpected fixture request" } }, { status: 403 });
    }
    if (body.toolCallId === "missing-result") {
      incompleteInvocations += 1;
      return Response.json({});
    }
    validInvocations += 1;
    return Response.json({ result: { message: "roundtrip", verified: true } });
  },
});
const observer = join(temp, "observe-plugin.ts");
const brokerModule = pathToFileURL(join(root, "extensions", "dist", "plugin-broker.mjs")).href;
await writeFile(observer, `import { setupPluginBroker } from ${JSON.stringify(brokerModule)};
export default function (pi) {
  let captured;
  setupPluginBroker({ registerTool(tool) { captured = tool; } });
  pi.registerCommand("smoke-plugin-tools", {
    handler: async (_args, ctx) => {
      if (!pi.getAllTools().some((tool) => tool.name === "smoke_plugin_tool")) {
        throw new Error("Bundled plugin tool registration missing");
      }
      if (${JSON.stringify(inbox)} && pi.getAllTools().some((tool) => tool.name.startsWith("qveris_"))) {
        throw new Error("Finance tools leaked into the development scene");
      }
      const result = await captured.execute("smoke-call", { message: "roundtrip" }, new AbortController().signal);
      if (result.details?.message !== "roundtrip" || result.details?.verified !== true
        || JSON.parse(result.content[0].text).verified !== true) {
        throw new Error("Bundled plugin result mismatch");
      }
      for (const [callId, errorCode] of [["unexpected-call", "http_403"], ["missing-result", "plugin_response_invalid"]]) {
        let rejected = false;
        try {
          await captured.execute(callId, { message: "roundtrip" }, new AbortController().signal);
        } catch (error) {
          rejected = String(error.message).startsWith("[" + errorCode + "]");
        }
        if (!rejected) throw new Error("Bundled plugin failed to reject a bad HTTP result");
      }
      ctx.ui.notify("smoke plugin metadata verified", "info");
    },
  });
}\n`);

const subprocess = Bun.spawn(
  [binary, "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-themes", "--extension", extension, ...extraExtensions,
    "--extension", join(root, "extensions", "dist", "plugin-broker.mjs"), "--extension", observer],
  {
    cwd: temp,
    env: {
      ...smokeRuntimeEnvironment(temp),
      PI_DESKTOP_SCENE_ID: scene,
      PI_DESKTOP_INSTANCE_ID: inbox ? "inbox-smoke" : "finance-smoke",
      PI_DESKTOP_PLUGIN_HOST_ORIGIN: `http://127.0.0.1:${brokerServer.port}`,
      PI_DESKTOP_PLUGIN_BROKER_TOKEN: "local-fixture-only",
      PI_DESKTOP_PLUGIN_RUNTIME_ID: "smoke-runtime",
      PI_DESKTOP_PLUGIN_SESSION_ID: "smoke-session",
      PI_DESKTOP_PLUGIN_TOOLS: JSON.stringify([{ pluginId: "smoke", name: "smoke_plugin_tool",
        title: "Smoke fixture", description: "Registration fixture only", capability: "smoke.read",
        inputSchema: { type: "object", properties: {} } }]),
      PI_DESKTOP_ALLOWED_TOOLS: JSON.stringify(inbox ? ["smoke_plugin_tool"] : [
        "qveris_status", "qveris_discover", "qveris_inspect", "qveris_call", "finance_backtest",
      ]),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  },
);

const stderrPromise = (async () => {
  for await (const _chunk of subprocess.stderr) { /* drain without retaining diagnostic content */ }
})();
const startedAt = performance.now();
let deadlineExpired = false;
// A fresh Pi/Jiti cache must transpile the bundled Inbox SDK before RPC starts.
// Bound the entire smoke run without treating that cold startup as missing commands.
const timeout = setTimeout(() => { deadlineExpired = true; subprocess.kill(); }, 60_000);
let commandsReadyMs;
let exitCode;
let forced = false;
const stdoutReader = subprocess.stdout.getReader();
let stdoutDrain;
try {
  subprocess.stdin.write(`${JSON.stringify({ id: "finance-smoke", type: "get_commands" })}\n`);
  let buffer = "";
  let response;
  for (;;) {
    const { value: chunk, done } = await stdoutReader.read();
    if (done) break;
    buffer += new TextDecoder().decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      if (frame.id === "finance-smoke" && frame.type === "response") {
        response = frame;
        break;
      }
    }
    if (response) break;
  }
  const names = new Set((response?.data?.commands ?? []).map((command) => command.name));
  const required = inbox
    ? ["picot-config", "chat-config", "chat-list", "chat-connect", "chat-new", "chat-disconnect", "chat-status"]
    : ["picot-config", "finance-status"];
  if (response?.success !== true || required.some((name) => !names.has(name))) {
    throw new Error(`Built-in ${inbox ? "Inbox" : "finance"} commands failed to register with embedded Pi (deadlineExpired=${deadlineExpired}, responseReceived=${!!response}, elapsedMs=${Math.round(performance.now() - startedAt)}, missing=${required.filter((name) => !names.has(name)).join(",")}).`);
  }
  if (inbox && names.has("finance-status")) throw new Error("Finance commands leaked into the development scene");
  commandsReadyMs = Math.round(performance.now() - startedAt);
  subprocess.stdin.write(`${JSON.stringify({ id: "plugin-smoke", type: "prompt", message: "/smoke-plugin-tools" })}\n`);
  let accepted = false;
  let verified = false;
  while (!accepted || !verified) {
    const { value, done } = await stdoutReader.read();
    if (done) throw new Error("Pi exited before plugin metadata verification");
    buffer += new TextDecoder().decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line);
      if (frame.type === "extension_error") throw new Error("Plugin smoke extension failed");
      if (frame.id === "plugin-smoke" && frame.type === "response") {
        if (frame.success !== true) throw new Error("Plugin metadata command failed");
        accepted = true;
      }
      if (frame.type === "extension_ui_request" && frame.message === "smoke plugin metadata verified") verified = true;
    }
  }
  if (validInvocations !== 1 || rejectedInvocations !== 1 || incompleteInvocations !== 1) {
    throw new Error("Plugin fixture invocation counts did not match success and failure cases");
  }
} finally {
  clearTimeout(timeout);
  // Keep stdout open through session_shutdown notifications; cancelling the
  // stream after get_commands can make Pi fail with a broken output pipe.
  stdoutDrain = (async () => {
    while (!(await stdoutReader.read()).done) { /* drain */ }
  })();
  subprocess.stdin.end();
  const shutdownTimeout = setTimeout(() => { forced = true; subprocess.kill(); }, 5000);
  try {
    exitCode = await subprocess.exited;
    await Promise.all([stderrPromise, stdoutDrain]);
  } finally {
    clearTimeout(shutdownTimeout);
    brokerServer.stop(true);
    await rm(temp, { recursive: true, force: true });
  }
}
if (forced || exitCode !== 0) throw new Error(`Built-in extension smoke did not exit normally (${exitCode}, forced=${forced}).`);
console.log(`Embedded Pi loaded ${inbox ? "Inbox" : "finance"} commands (startupMs=${commandsReadyMs}), verified bundled plugin HTTP roundtrip, then exited normally.`);
