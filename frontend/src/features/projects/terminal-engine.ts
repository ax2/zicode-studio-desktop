import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { EngineOptions, TerminalEngine } from "./project-terminal";

let css: Promise<void> | undefined;
function stylesheet(): Promise<void> {
  if (!css)
    css = new Promise<void>((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/native/react/project-terminal-engine.css";
      link.onload = () => resolve();
      link.onerror = () => {
        link.remove();
        css = undefined;
        reject(new Error("terminal_styles_unavailable"));
      };
      document.head.append(link);
    });
  return css;
}

export async function createTerminal(
  element: HTMLElement,
  options: EngineOptions,
): Promise<TerminalEngine> {
  await stylesheet();
  const terminal = new Terminal({
    cursorBlink: true,
    scrollback: 3000,
    screenReaderMode: true,
    // Terminal glyphs require a fixed-width grid; surrounding controls use app typography.
    fontFamily: "monospace",
    disableStdin: true,
    linkHandler: { activate: () => {} },
    windowOptions: {},
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);
  const encoder = new TextEncoder();
  let replaying = false;
  let inputEnabled = false;
  const listeners = [
    terminal.onData((data) => {
      if (!replaying) options.onData(encoder.encode(data));
    }),
    terminal.onBinary((data) => {
      if (!replaying) options.onData(Uint8Array.from(data, (char) => char.charCodeAt(0)));
    }),
    terminal.onResize(({ cols, rows }) => options.onResize(cols, rows)),
    // OSC 52 may request clipboard access. It stays inside the terminal.
    terminal.parser.registerOscHandler(52, () => true),
  ];
  let frame = 0;
  const layout = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const dimensions = fit.proposeDimensions();
      if (dimensions)
        terminal.resize(
          Math.min(500, Math.max(2, dimensions.cols)),
          Math.min(200, Math.max(2, dimensions.rows)),
        );
    });
  };
  const theme = () => {
    const style = getComputedStyle(element);
    terminal.options.fontSize = Number.parseFloat(style.getPropertyValue("--font-size-md")) || 14;
    terminal.options.theme = {
      background: style.getPropertyValue("--bg-solid").trim(),
      foreground: style.getPropertyValue("--text-primary").trim(),
      cursor: style.getPropertyValue("--text-primary").trim(),
    };
    layout();
  };
  const observer = new ResizeObserver(layout);
  observer.observe(element);
  const themes = new MutationObserver(theme);
  themes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "style"],
  });
  themes.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-theme", "style"],
  });
  theme();
  return {
    write: (bytes, done, replay = false) => {
      replaying = replay;
      terminal.options.disableStdin = replay || !inputEnabled;
      terminal.write(bytes, () => {
        replaying = false;
        terminal.options.disableStdin = !inputEnabled;
        done();
      });
    },
    reset: () => terminal.reset(),
    enableInput: (enabled) => {
      inputEnabled = enabled;
      terminal.options.disableStdin = replaying || !enabled;
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      themes.disconnect();
      for (const listener of listeners) listener.dispose();
      terminal.dispose();
    },
  };
}
