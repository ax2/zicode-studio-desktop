// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const script = read("./build-desktop.js");
const root = path.resolve("shell-release-fixture");
const target = path.join(root, "target");

async function invoke(args, { platform = "win32", shellStatus = 0, stageError } = {}) {
  const stageLocalResources = vi.fn(async () => { if (stageError) throw stageError; return 1; });
  const spawn = vi.fn(() => ({ status: shellStatus }));
  const files = { mkdirSync: vi.fn(), copyFileSync: vi.fn(),
    readFileSync: vi.fn(() => JSON.stringify({ build: {
      beforeBuildCommand: "bun run fetch:webview2 && bun run build:react",
    }, bundle: { resources: { "../public": "public" } } })) };
  let exit;
  const stopped = {};
  const loggedError = vi.fn();
  const process = {
    argv: ["bun", "scripts/build-desktop.js", ...args],
    execPath: "bun", platform,
    exit(code) { exit = code; throw stopped; },
  };
  try {
    await runInNewContext(script, {
      __dirname: path.join(root, "scripts"),
      require(name) {
        if (name === "node:path") return path;
        if (name === "node:fs") return files;
        if (name === "node:child_process") return { spawnSync: spawn };
        if (name === "./cargo-path") return { withCargoBin: () => ({ CARGO_TARGET_DIR: target }) };
        if (name === "./stage-local-resources") return { stageLocalResources };
        throw new Error("Unexpected module: " + name);
      },
      process,
      console: { log: vi.fn(), error: loggedError },
    });
  } catch (error) {
    if (error !== stopped) throw error;
  }
  return { exit: exit ?? process.exitCode ?? 0, spawn, files, stageLocalResources, loggedError };
}

it("prepares the release DLL from locked sources in the shared target and stops before the app build", async () => {
  const result = await invoke(["--shell-only"]);
  expect(result.exit).toBe(0);
  expect(result.spawn).toHaveBeenCalledOnce();
  const [command, args, options] = result.spawn.mock.calls[0];
  expect(command).toBe("cargo");
  expect(args).toEqual(["build", "--locked", "--manifest-path", path.join(root, "shell", "Cargo.toml"),
    "--target-dir", target, "--release"]);
  expect(options.env.CARGO_TARGET_DIR).toBe(target);
  expect(result.files.copyFileSync).toHaveBeenCalledWith(
    path.join(target, "release", "zicode_studio_shell.dll"),
    path.join(root, "src-tauri", "resources", "shell", "zicode_studio_shell.dll"),
  );
});

it("bundles local Windows release builds with the shared target tool cache", async () => {
  const result = await invoke([]);
  expect(result.exit).toBe(0);
  expect(result.spawn).toHaveBeenCalledTimes(2);
  const args = result.spawn.mock.calls[1][1];
  expect(args.slice(0, -1)).toEqual([
    "run", "tauri", "build", "--bundles", "nsis", "--config", "src-tauri/tauri.shell.windows.conf.json", "--config",
  ]);
  expect(JSON.parse(args.at(-1))).toEqual({ bundle: { useLocalToolsDir: true } });
});

it("keeps local builds beside the debug DLL and skips installer-only preparation", async () => {
  const result = await invoke(["--local"]);
  expect(result.exit).toBe(0);
  expect(result.spawn).toHaveBeenCalledTimes(2);
  expect(result.spawn.mock.calls[0][1]).not.toContain("--release");
  expect(result.files.copyFileSync).not.toHaveBeenCalled();
  expect(result.stageLocalResources).toHaveBeenCalledWith(path.join(root, "src-tauri"), path.join(target, "debug"), { "../public": "public" });
  const build = result.spawn.mock.calls[1][1];
  expect(build.slice(0, 6)).toEqual(["run", "tauri", "build", "--debug", "--no-bundle", "--config"]);
  expect(JSON.parse(build[6]).build.beforeBuildCommand).toBe("bun run build:react");
  expect(build).not.toContain("src-tauri/tauri.shell.windows.conf.json");
});

it("does not stage or package after a failed bridge build and requires Windows for shell-only", async () => {
  const failed = await invoke(["--shell-only"], { shellStatus: 1 });
  expect(failed.exit).toBe(1);
  expect(failed.spawn).toHaveBeenCalledOnce();
  expect(failed.files.copyFileSync).not.toHaveBeenCalled();
  const unsupported = await invoke(["--shell-only"], { platform: "darwin" });
  expect(unsupported.exit).toBe(1);
  expect(unsupported.spawn).not.toHaveBeenCalled();
});

it("builds the Windows bridge before bundling and requires the installer DLL in the exported candidate", () => {
  const workflow = read("../.github/workflows/release.yml");
  const prepare = workflow.indexOf("- name: Prepare Windows Explorer selection bridge");
  expect(prepare).toBeGreaterThan(0);
  const bridgeStep = workflow.slice(prepare, workflow.indexOf("- name:", prepare + 8));
  expect(bridgeStep).toContain("if: runner.os == 'Windows'");
  expect(bridgeStep).toContain('CARGO_HTTP_MULTIPLEXING: "false"');
  expect(bridgeStep).toContain('CARGO_NET_RETRY: "10"');
  expect(prepare).toBeLessThan(workflow.indexOf("- name: Build local platform bundles"));
  expect(workflow).toContain("run: bun scripts/build-desktop.js --shell-only");
  expect(workflow).toContain("runner.os == 'Windows' && '--config src-tauri/tauri.shell.windows.conf.json'");
  const overlay = JSON.parse(read("../src-tauri/tauri.shell.windows.conf.json"));
  expect(overlay.bundle.resources["./resources/shell/zicode_studio_shell.dll"]).toBe("zicode_studio_shell.dll");
  const exporter = read("./export-windows-candidate.ps1");
  expect(exporter).toContain("$files = @($entries[0], $shell)");
  expect(exporter).toContain("Copy-Item -LiteralPath $shell.FullName -Destination (Join-Path $candidate $shellName)");
  expect(exporter).toContain("Get-FileHash -LiteralPath $stagedShell -Algorithm SHA256");
  expect(exporter).toContain("Installer Explorer selection bridge differs from the staged build");
});

it("fails a successful local compile when the resource update is rejected", async () => {
  const result = await invoke(["--local"], { stageError: Error("destination is locked") });
  expect(result.exit).toBe(1);
  expect(result.loggedError).toHaveBeenCalledWith("[build-desktop] Local runtime resources failed:", "destination is locked");
});
