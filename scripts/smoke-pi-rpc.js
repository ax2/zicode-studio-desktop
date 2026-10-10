import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { smokeRuntimeEnvironment } from "./smoke-runtime-environment.js";

const root = resolve(import.meta.dir, "..");
const { version: piVersion } = await Bun.file(join(root, "scripts", "pi-version.json")).json();
const binary = join(
  root,
  "src-tauri",
  "resources",
  "pi",
  process.platform === "win32" ? "pi.exe" : "pi",
);
const fixtureDir = join(root, "tests", "fixtures", "pi-rpc", piVersion);
const update = process.argv.includes("--update");
const temp = await mkdtemp(join(tmpdir(), "picot-rpc-smoke-"));
const extension = join(temp, "smoke-extension.ts");
const skill = join(temp, "smoke-skill");
await mkdir(skill);
await writeFile(join(skill, "SKILL.md"),
  "---\nname: picot-smoke-skill\ndescription: Deterministic RPC command discovery fixture\n---\n\nUse only for local command discovery.\n");

await writeFile(
  extension,
  `export default function (pi) {
    pi.registerCommand("picot-smoke", {
      description: "ZiCode Studio Desktop RPC contract smoke command",
      handler: async (_args, ctx) => ctx.ui.notify("picot smoke accepted", "info"),
    });
  }\n`,
);

const environment = smokeRuntimeEnvironment(temp);
const versionProbe = Bun.spawnSync([binary, "--version"], {
  cwd: temp, env: environment, stdout: "pipe", stderr: "pipe",
});
if (versionProbe.exitCode !== 0 || new TextDecoder().decode(versionProbe.stdout).trim() !== piVersion) {
  await rm(temp, { recursive: true, force: true });
  throw new Error(`Embedded Pi version does not match locked version ${piVersion}`);
}
const subprocess = Bun.spawn([binary, "--mode", "rpc", "--no-session",
  "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes",
  "--extension", extension, "--skill", skill], {
  cwd: temp,
  env: environment,
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});
// Drain diagnostic output without retaining runtime messages or configuration.
const stderrReader = (async () => {
  for await (const _chunk of subprocess.stderr) { /* drain */ }
})();

const pending = new Map();
const observedEvents = [];
let stdoutBuffer = "";
let nextId = 1;

const reader = (async () => {
  for await (const chunk of subprocess.stdout) {
    stdoutBuffer += new TextDecoder().decode(chunk, { stream: true });
    for (;;) {
      const newline = stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      const frame = JSON.parse(line);
      const waiter = frame.id && pending.get(frame.id);
      if (waiter && frame.type === "response") {
        pending.delete(frame.id);
        waiter.resolve(frame);
      } else {
        observedEvents.push(frame);
      }
    }
  }
})();

function request(command, timeoutMs = 5_000) {
  const id = `smoke-${nextId++}`;
  const frame = { id, ...command };
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Timed out waiting for ${command.type}`));
    }, timeoutMs);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timeout);
        resolveRequest(value);
      },
    });
    subprocess.stdin.write(`${JSON.stringify(frame)}\n`);
  });
}

function assertSuccess(frame, command) {
  if (frame.type !== "response" || frame.command !== command || frame.success !== true) {
    throw new Error(`Unexpected ${command} response: ${JSON.stringify(frame)}`);
  }
}

let shutdownForced = false;
let successMessage = "";
let exitCode;
try {
  const state = await request({ type: "get_state" });
  const commands = await request({ type: "get_commands" });
  const steering = await request({ type: "set_steering_mode", mode: "all" });
  const followUp = await request({ type: "set_follow_up_mode", mode: "one-at-a-time" });
  const prompt = await request({ type: "prompt", message: "/picot-smoke" });
  const abort = await request({ type: "abort" });
  for (const [name, frame] of Object.entries({
    get_state: state,
    get_commands: commands,
    set_steering_mode: steering,
    set_follow_up_mode: followUp,
    prompt,
    abort,
  })) {
    assertSuccess(frame, name);
  }

  const contract = {
    version: piVersion,
    commands: [
      "get_state",
      "get_commands",
      "set_steering_mode",
      "set_follow_up_mode",
      "prompt",
      "abort",
    ],
    stateFields: Object.keys(state.data ?? {}).sort(),
    commandSources: [...new Set((commands.data?.commands ?? []).map((item) => item.source))].sort(),
    eventTypes: [...new Set(observedEvents.map((event) => event.type))].sort(),
    promptAcceptance: prompt.success,
  };
  const fixture = join(fixtureDir, "contract.json");
  if (update) {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(fixture, `${JSON.stringify(contract, null, 2)}\n`);
  } else {
    const expected = await Bun.file(fixture).json();
    if (JSON.stringify(contract) !== JSON.stringify(expected)) {
      throw new Error(
        `Pi RPC contract drifted. Run bun run smoke:pi-rpc --update after review.\n${JSON.stringify(contract, null, 2)}`,
      );
    }
  }
  successMessage = `Pi ${contract.version} RPC smoke passed (${contract.commands.length} commands)`;
} finally {
  subprocess.stdin.end();
  let shutdownTimeout;
  try {
    await Promise.race([
      subprocess.exited,
      new Promise((resolveTimeout) => {
        shutdownTimeout = setTimeout(() => {
          shutdownForced = true;
          subprocess.kill();
          resolveTimeout();
        }, 5000);
      }),
    ]);
    exitCode = await subprocess.exited;
    await Promise.all([reader, stderrReader]);
  } finally {
    clearTimeout(shutdownTimeout);
    await rm(temp, { recursive: true, force: true });
  }
}
if (shutdownForced) throw new Error("Pi RPC smoke required forced shutdown after stdin closed");
if (exitCode !== 0) throw new Error(`Pi RPC smoke exited with code ${exitCode}`);
console.log(successMessage);
