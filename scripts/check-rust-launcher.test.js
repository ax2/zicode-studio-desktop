import { afterEach, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync: spawn, default: { spawnSync: spawn } }));
const platform = Object.getOwnPropertyDescriptor(process, "platform");
const argv = process.argv;
afterEach(() => {
  Object.defineProperty(process, "platform", platform);
  process.argv = argv;
  vi.restoreAllMocks(); vi.resetModules(); spawn.mockReset();
});
async function run(args = []) {
  Object.defineProperty(process, "platform", { value: "win32" });
  process.argv = ["node", "check-rust.mjs", ...args];
  vi.spyOn(process, "exit").mockImplementation(code => { throw new Error(`exit:${code}`); });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await import("./check-rust.mjs");
}
it("uses native Cargo and hidden subprocesses for static checks while retaining compiler paths", async () => {
  spawn.mockReturnValue({ status: 0 });
  await run(["--static-only"]);
  expect(spawn.mock.calls.map(call => [call[0], call[1][0]])).toEqual([["cargo", "check"], ["cargo", "clippy"], ["cargo", "fmt"]]);
  const options = spawn.mock.calls[0][2];
  expect(options.windowsHide).toBe(true);
  const key = Object.keys(process.env).find(name => name.toUpperCase() === "PATH");
  if (key) expect(options.env[key]).toContain(process.env[key]);
  expect(spawn.mock.calls[1][1].slice(-3)).toEqual(["--", "-D", "warnings"]);
});
it("includes tests for the full check and stops immediately on Cargo failure", async () => {
  spawn.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 101 });
  await expect(run()).rejects.toThrow("exit:101");
  expect(spawn.mock.calls.map(call => call[1][0])).toEqual(["check", "test"]);
});
it("rejects unsupported flags without starting a subprocess", async () => {
  await expect(run(["--skip-checks"])).rejects.toThrow("exit:2");
  expect(spawn).not.toHaveBeenCalled();
});
it("keeps formatting advisory after successful check and clippy", async () => {
  spawn.mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 });
  await run(["--static-only"]);
  expect(console.warn).toHaveBeenCalled();expect(process.exit).not.toHaveBeenCalled();
});
