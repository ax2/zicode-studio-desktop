import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const binary = join(
  root,
  "src-tauri",
  "resources",
  "pi",
  process.platform === "win32" ? "pi.exe" : "pi",
);
const extension = join(root, "extensions", "dist", "picot-bridge.mjs");
const temp = await mkdtemp(join(tmpdir(), "zicode-finance-smoke-"));
await writeFile(join(temp, "auth.json"), "{}");

const subprocess = Bun.spawn(
  [binary, "--mode", "rpc", "--no-session", "--extension", extension],
  {
    cwd: temp,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: temp,
      PI_DESKTOP_SCENE_ID: "finance",
      PI_DESKTOP_INSTANCE_ID: "finance-smoke",
      PI_DESKTOP_ALLOWED_TOOLS: JSON.stringify([
        "qveris_status",
        "qveris_discover",
        "qveris_inspect",
        "qveris_call",
        "finance_backtest",
      ]),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  },
);

const stderrPromise = new Response(subprocess.stderr).text();
const timeout = setTimeout(() => subprocess.kill(), 10_000);
try {
  subprocess.stdin.write(`${JSON.stringify({ id: "finance-smoke", type: "get_commands" })}\n`);
  let buffer = "";
  let response;
  for await (const chunk of subprocess.stdout) {
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
  const financeCommand = response?.data?.commands?.find(
    (command) => command.name === "finance-status",
  );
  if (response?.success !== true || !financeCommand) {
    const stderr = await stderrPromise;
    throw new Error(
      `Finance extension failed to register with embedded Pi.\n${stderr.slice(0, 2_000)}`,
    );
  }
  console.log("Embedded Pi loaded the finance workbench extension.");
} finally {
  clearTimeout(timeout);
  subprocess.stdin.end();
  await subprocess.exited;
  await rm(temp, { recursive: true, force: true });
}
