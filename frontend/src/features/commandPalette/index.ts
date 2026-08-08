import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { CommandPaletteApp } from "./CommandPaletteApp";
import {
  resolveCommands,
  type PaletteCommand,
  type PaletteCommandSource,
} from "./commandPaletteLogic";

export interface CommandPaletteHandle {
  open(): void;
  close(options?: { restoreFocus?: boolean }): void;
}

export function setupCommandPalette({
  button,
  palette,
  overlay,
  list,
  commands,
  onError = console.error,
}: {
  button?: HTMLElement | null;
  palette?: HTMLElement | null;
  overlay?: HTMLElement | null;
  list?: HTMLElement | null;
  commands?: PaletteCommandSource;
  onError?: (error: unknown) => void;
} = {}): CommandPaletteHandle {
  if (!button || !palette || !overlay || !list) {
    return {
      open() {},
      close() {},
    };
  }

  const trigger = button;
  const panel = palette;
  const backdrop = overlay;
  const container = list;

  const root: Root = createRoot(container);

  function close({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    panel.classList.add("hidden");
    backdrop.classList.add("hidden");
    flushSync(() => {
      root.render(null);
    });
    if (restoreFocus) trigger.focus();
  }

  function runCommand(command: PaletteCommand) {
    close({ restoreFocus: false });
    try {
      const result = command.action?.();
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        (result as Promise<unknown>).catch(onError);
      }
    } catch (error) {
      onError(error);
    }
  }

  function open() {
    panel.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    flushSync(() => {
      root.render(
        createElement(CommandPaletteApp, {
          commands: resolveCommands(commands ?? []),
          onRun: runCommand,
        }),
      );
    });
    (container.querySelector(".command-palette-search") as HTMLElement | null)?.focus();
  }

  trigger.addEventListener("click", open);
  backdrop.addEventListener("click", () => close());

  document.addEventListener("keydown", (event) => {
    if (panel.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...panel.querySelectorAll(
        "button:not(:disabled), input, [href], [tabindex]",
      ),
    ].filter((element) => element.getAttribute("tabindex") !== "-1");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !panel.contains(document.activeElement))
    ) {
      event.preventDefault();
      (last as HTMLElement).focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      (first as HTMLElement).focus();
    }
  });

  return { open, close };
}
