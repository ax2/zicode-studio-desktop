import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { CommandPaletteRoot } from "./CommandPaletteRoot";
import type { ManualTool, ManualToolApi } from "../toolCenter/manual-tools";
import {
  type PaletteCommand,
  type PaletteCommandSource,
  resolveCommands,
} from "./commandPaletteLogic";
import { runWithRecent, type ToolAccessScope, type ToolAccessStore } from "./tool-access";

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
  accessStore,
  getScope,
  toolApi,
  getToolApi,
  onOpenTool,
  onError = console.error,
}: {
  button?: HTMLElement | null;
  palette?: HTMLElement | null;
  overlay?: HTMLElement | null;
  list?: HTMLElement | null;
  commands?: PaletteCommandSource;
  accessStore?: ToolAccessStore;
  getScope?: () => ToolAccessScope;
  toolApi?: ManualToolApi;
  getToolApi?: () => ManualToolApi | undefined;
  onOpenTool?: (tool: ManualTool, revision: string, scope: ToolAccessScope) => unknown;
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
  let previousFocus: HTMLElement | null = null;
  let openGeneration = 0;

  function close({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    panel.classList.add("hidden");
    backdrop.classList.add("hidden");
    flushSync(() => {
      root.render(null);
    });
    if (restoreFocus) {
      (previousFocus?.isConnected ? previousFocus : trigger).focus();
    }
    previousFocus = null;
  }

  function runCommand(command: PaletteCommand, scope?: ToolAccessScope) {
    close({ restoreFocus: false });
    void runWithRecent(command, accessStore, scope).catch(onError);
  }

  function open() {
    const activeToolApi = getToolApi?.() ?? toolApi;
    const scope = getScope?.();
    const fixedScope = scope ? { sceneId: scope.sceneId, workspaceId: scope.workspaceId } : undefined;
    const active = document.activeElement;
    previousFocus =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
        ? active
        : null;
    panel.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    flushSync(() => {
      root.render(
        createElement(CommandPaletteRoot, {
          key: ++openGeneration,
          commands: resolveCommands(commands ?? []),
          accessStore,
          scope: fixedScope,
          tools: activeToolApi && onOpenTool && fixedScope ? {
            api: activeToolApi, scope: fixedScope,
            onOpen: (tool: ManualTool, revision: string) => {
              close({ restoreFocus: false });
              void Promise.resolve().then(() => onOpenTool(tool, revision, fixedScope)).catch(onError);
            },
          } : undefined,
          onRun: (command: PaletteCommand) => runCommand(command, fixedScope),
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
