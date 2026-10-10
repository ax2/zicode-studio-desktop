import { afterEach, expect, it, vi } from "vitest";
import type { TerminalApi, TerminalEngine, TerminalFrame, TerminalInfo } from "./project-terminal";
import { connectTerminal } from "./terminal-connection";

const info: TerminalInfo = {
  id: "term",
  workspaceId: "project",
  shell: "shell",
  status: "running",
  cols: 80,
  rows: 24,
  exitCode: null,
  outputClosed: false,
  outputEnd: 3,
};
function setup(request: TerminalApi["request"]) {
  const engine: TerminalEngine = {
    write: vi.fn((_bytes, done) => done()),
    reset: vi.fn(),
    enableInput: vi.fn(),
    dispose: vi.fn(),
  };
  const callbacks = { state: vi.fn(), error: vi.fn(), truncated: vi.fn() };
  const api = { canUse: true, request: vi.fn(request) };
  const connection = connectTerminal(api, "project", "term", engine, callbacks);
  return { engine, callbacks, api, connection };
}

it("separates cached replay from live bytes so historical queries cannot send input", async () => {
  vi.useFakeTimers();
  const engine: TerminalEngine = {
    write: vi.fn((_bytes, done) => done()),
    reset: vi.fn(),
    enableInput: vi.fn(),
    dispose: vi.fn(),
  };
  const api: TerminalApi = { canUse: true, request: vi.fn(async () => frame()) };
  const connection = connectTerminal(
    api,
    "project",
    "term",
    engine,
    { state: vi.fn(), error: vi.fn(), truncated: vi.fn() },
    2,
  );
  await vi.advanceTimersByTimeAsync(0);
  const writes = vi.mocked(engine.write).mock.calls;
  expect([...writes[0][0]]).toEqual([97, 98]);
  expect(writes[0][2]).toBe(true);
  expect([...writes[1][0]]).toEqual([99]);
  expect(writes[1][2]).toBe(false);
  connection.dispose();
});
function frame(patch: Partial<TerminalInfo> = {}): TerminalFrame {
  return {
    terminal: { ...info, ...patch },
    chunk: { data: btoa("abc"), nextOffset: 3, truncated: false },
  };
}
afterEach(() => vi.useRealTimers());

it("waits for the renderer before advancing output and coalesces resize requests", async () => {
  vi.useFakeTimers();
  const test = setup(async () => frame());
  let rendered!: () => void;
  vi.mocked(test.engine.write).mockImplementation((_bytes, done) => {
    rendered = done;
  });
  test.connection.resize(90, 30);
  test.connection.resize(100, 40);
  await vi.advanceTimersByTimeAsync(0);
  expect(test.api.request).toHaveBeenCalledTimes(1);
  rendered();
  await vi.advanceTimersByTimeAsync(0);
  expect(test.api.request).toHaveBeenLastCalledWith("terminal_resize", "project", {
    terminalId: "term",
    cols: 100,
    rows: 40,
  });
  test.connection.dispose();
});

it("chunks Unicode input as bytes in order without exceeding the host frame limit", async () => {
  vi.useFakeTimers();
  const test = setup(async (operation) => (operation === "terminal_read" ? frame() : {}));
  await vi.advanceTimersByTimeAsync(0);
  const bytes = new TextEncoder().encode("中文🙂".repeat(1000));
  test.connection.input(bytes);
  await vi.advanceTimersByTimeAsync(0);
  const chunks = test.api.request.mock.calls
    .filter(([operation]) => operation === "terminal_input")
    .map(([, , args]) => Uint8Array.from(atob(args?.data as string), (char) => char.charCodeAt(0)));
  expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
  expect(chunks.flatMap((chunk) => [...chunk])).toEqual([...bytes]);
  test.connection.dispose();
});

it("never retries ambiguous input or lets an in-flight read restore input after failure", async () => {
  vi.useFakeTimers();
  let read!: (frame: TerminalFrame) => void;
  let reads = 0;
  const test = setup(async (operation) => {
    if (operation === "terminal_read") {
      if (++reads === 1) return frame();
      return new Promise((resolve) => {
        read = resolve;
      });
    }
    throw new Error("timeout");
  });
  await vi.advanceTimersByTimeAsync(31);
  test.connection.input(new TextEncoder().encode("dangerous\r"));
  await vi.advanceTimersByTimeAsync(0);
  read(frame());
  await vi.advanceTimersByTimeAsync(300);
  test.connection.input(new TextEncoder().encode("again\r"));
  expect(
    test.api.request.mock.calls.filter(([operation]) => operation === "terminal_input"),
  ).toHaveLength(1);
  expect(test.engine.enableInput).toHaveBeenLastCalledWith(false);
  expect(test.callbacks.error).toHaveBeenCalledTimes(1);
  test.connection.dispose();
});

it("resets the emulator on truncated replay and disables input for exited sessions", async () => {
  vi.useFakeTimers();
  const test = setup(async () => ({
    ...frame({ status: "exited", outputClosed: true, exitCode: 0 }),
    chunk: { data: "", nextOffset: 3, truncated: true },
  }));
  await vi.advanceTimersByTimeAsync(500);
  expect(test.engine.reset).toHaveBeenCalledOnce();
  expect(test.callbacks.truncated).toHaveBeenCalledOnce();
  expect(test.engine.enableInput).toHaveBeenLastCalledWith(false);
  expect(test.api.request).toHaveBeenCalledOnce();
  test.connection.dispose();
});

it("ignores late output after switching projects without stopping the host session", async () => {
  let resolve!: (frame: TerminalFrame) => void;
  const test = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  test.connection.dispose();
  resolve(frame());
  await Promise.resolve();
  expect(test.engine.write).not.toHaveBeenCalled();
  expect(test.api.request.mock.calls.some(([operation]) => operation === "terminal_close")).toBe(
    false,
  );
});

it("rejects an oversized paste locally and sends no input", async () => {
  vi.useFakeTimers();
  const test = setup(async () => frame());
  await vi.advanceTimersByTimeAsync(0);
  test.connection.input(new Uint8Array(65537));
  expect(test.callbacks.error).toHaveBeenCalledOnce();
  expect(test.api.request.mock.calls.some(([operation]) => operation === "terminal_input")).toBe(
    false,
  );
  test.connection.dispose();
});
