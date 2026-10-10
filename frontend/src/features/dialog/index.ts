import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { NativeDialogApp, type NativeDialogStore } from "./DialogApp";
import {
  type NativeDialogRequest,
  parseDialogContent,
} from "./dialogLogic";


export type { DialogContent, DialogOption, NativeDialogRequest } from "./dialogLogic";
export {
  defaultTitle,
  parseDialogContent,
  parseOption,
} from "./dialogLogic";

export interface NativeDialogResult {
  value?: unknown;
  confirmed?: boolean;
  cancelled?: boolean;
}

export function showNativeDialog(
  request: NativeDialogRequest = {},
  container: HTMLElement | null = document.getElementById("dialog-container"),
  { dismissSignal }: { dismissSignal?: Promise<unknown> } = {},
): Promise<NativeDialogResult> {
  return new Promise((resolve) => {
    if (!container) {
      resolve({ cancelled: true });
      return;
    }
    const activeContainer = container;
    const content = parseDialogContent(request);
    const store: NativeDialogStore = {
      method: request.method ?? "input",
      header: content.header,
      title: content.title,
      body: content.body,
      previews: content.previews,
      options: request.options ?? [],
      prefill: request.prefill ?? "",
      placeholder: request.placeholder ?? "",
    };

    let root: Root | null = null;
    flushSync(() => {
      root = createRoot(activeContainer);
      root.render(
        createElement(NativeDialogApp, {
          store,
          onFinish: finish,
          onInputRef: () => {},
        }),
      );
    });
    activeContainer.classList.remove("hidden");
    const lastFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial = activeContainer.querySelector<HTMLElement>(
      ".dialog-input, .dialog-textarea, .dialog button",
    );
    initial?.focus();

    let timeout: ReturnType<typeof setTimeout> | null = null;
    if (request.timeout) {
      timeout = setTimeout(() => finish({ cancelled: true }), request.timeout);
    }

    const keyHandler = (event: KeyboardEvent) => {
      const input = activeContainer.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        ".dialog-input, .dialog-textarea",
      );
      if (event.key === "Escape") {
        event.preventDefault();
        finish({ cancelled: true });
      }
      if (input && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish({ value: input.value });
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...activeContainer.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input, textarea, [href], [tabindex]",
        ),
      ].filter((element) => element.getAttribute("tabindex") !== "-1");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !activeContainer.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keyHandler);

    function finish(result: NativeDialogResult) {
      if (timeout) clearTimeout(timeout);
      document.removeEventListener("keydown", keyHandler);
      root?.unmount();
      root = null;
      activeContainer.replaceChildren();
      activeContainer.classList.add("hidden");
      if (lastFocused?.isConnected) lastFocused.focus();
      resolve(result);
    }

    dismissSignal?.then(
      () => finish({ cancelled: true }),
      () => finish({ cancelled: true }),
    );
  });
}
