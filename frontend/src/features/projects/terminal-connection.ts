import type { TerminalApi, TerminalEngine, TerminalInfo } from "./project-terminal";
import { terminalList } from "./terminal-list";

const MAX_FRAME_BYTES = 32 * 1024;

export function connectTerminal(
  api: TerminalApi,
  workspace: string,
  id: string,
  engine: TerminalEngine,
  callbacks: {
    state: (info: TerminalInfo) => void;
    error: (error: unknown) => void;
    truncated: () => void;
  },
  replayThrough = 0,
) {
  let alive = true;
  let healthy = false;
  let failed = false;
  let running = false;
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;
  let pendingBytes = 0;
  const queue: Uint8Array[] = [];
  let dimensions: [number, number] | undefined;
  let appliedDimensions = "";
  const parameters = { terminalId: id };
  const fail = (error: unknown) => {
    if (!alive) return;
    healthy = false;
    failed = true;
    queue.length = 0;
    pendingBytes = 0;
    clearTimeout(timer);
    engine.enableInput(false);
    callbacks.error(error);
  };
  async function flush() {
    if (writing || !alive || !healthy || !running) return;
    writing = true;
    try {
      while (alive && healthy && queue.length) {
        const bytes = queue.shift();
        if (!bytes) break;
        pendingBytes -= bytes.length;
        const data = btoa(String.fromCharCode(...bytes));
        await api.request("terminal_input", workspace, { ...parameters, data });
      }
    } catch (error) {
      fail(error);
    } finally {
      writing = false;
    }
  }
  async function poll() {
    try {
      const result = await api.request("terminal_read", workspace, { ...parameters, offset });
      if (!alive || failed) return;
      if (!result.terminal || !result.chunk) throw new Error("terminal_response_invalid");
      const { terminal, chunk } = result;
      terminalList([terminal], workspace);
      if (
        terminal.id !== id ||
        !Number.isSafeInteger(chunk.nextOffset) ||
        chunk.nextOffset < offset ||
        chunk.nextOffset > terminal.outputEnd ||
        typeof chunk.data !== "string" ||
        chunk.data.length > Math.ceil(MAX_FRAME_BYTES / 3) * 4 ||
        typeof chunk.truncated !== "boolean"
      )
        throw new Error("terminal_response_invalid");
      const bytes = chunk.data
        ? Uint8Array.from(atob(chunk.data), (char) => char.charCodeAt(0))
        : new Uint8Array();
      const start = chunk.nextOffset - bytes.length;
      if (bytes.length > MAX_FRAME_BYTES || start < 0 || chunk.truncated !== (start > offset))
        throw new Error("terminal_response_invalid");
      healthy = true;
      running = terminal.status === "running";
      engine.enableInput(running);
      callbacks.state(terminal);
      if (chunk.truncated) {
        engine.reset();
        callbacks.truncated();
      }
      if (bytes.length) {
        const replayLength = Math.min(bytes.length, Math.max(0, replayThrough - start));
        if (replayLength)
          await new Promise<void>((resolve) =>
            engine.write(bytes.slice(0, replayLength), resolve, true),
          );
        if (alive && bytes.length > replayLength)
          await new Promise<void>((resolve) =>
            engine.write(bytes.slice(replayLength), resolve, false),
          );
      }
      if (!alive || !healthy) return;
      offset = chunk.nextOffset;
      if (running && dimensions && dimensions.join(":") !== appliedDimensions) {
        const [cols, rows] = dimensions;
        await api.request("terminal_resize", workspace, { ...parameters, cols, rows });
        appliedDimensions = `${cols}:${rows}`;
      }
      if (
        alive &&
        healthy &&
        (running ||
          terminal.status === "stopping" ||
          !terminal.outputClosed ||
          offset < terminal.outputEnd)
      )
        timer = setTimeout(() => void poll(), chunk.data ? 30 : 120);
    } catch (error) {
      fail(error);
    }
  }
  void poll();
  return {
    input(bytes: Uint8Array) {
      if (!alive || !healthy || !running) return;
      if (pendingBytes + bytes.length > 64 * 1024) {
        fail(new Error("terminal_input_busy"));
        return;
      }
      for (let start = 0; start < bytes.length; start += 4096)
        queue.push(bytes.slice(start, start + 4096));
      pendingBytes += bytes.length;
      void flush();
    },
    resize(cols: number, rows: number) {
      dimensions = [cols, rows];
    },
    dispose() {
      alive = false;
      clearTimeout(timer);
      queue.length = 0;
      engine.enableInput(false);
    },
  };
}
