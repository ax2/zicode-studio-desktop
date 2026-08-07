export { createModelDropdownFeed } from "./modelDropdown";
export type { ModelDropdownFeed, ModelDropdownSnapshot, ModelLike } from "./modelDropdown";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { ComposerApp } from "./ComposerApp";

export interface ComposerElements {
  input: HTMLTextAreaElement;
  form: HTMLFormElement;
  abortButton: HTMLButtonElement;
  sendButton: HTMLButtonElement;
  composerCard: HTMLElement;
  commandButton: HTMLButtonElement;
  attachButton: HTMLButtonElement;
  imageInput: HTMLInputElement;
  imagePreviews: HTMLElement;
  skillSlashMenu: HTMLElement;
  queuedMessages: HTMLElement;
  modelDropdown: HTMLElement;
  modelDropdownBtn: HTMLButtonElement;
  modelDropdownLabel: HTMLElement;
  modelDropdownMenu: HTMLElement;
  thinkingBtn: HTMLButtonElement;
}

export function setupComposer(): ComposerElements | null {
  const rootElement = document.getElementById("composer-root");
  if (!rootElement) return null;
  let root: Root | null = null;
  flushSync(() => {
    root = createRoot(rootElement);
    root.render(createElement(ComposerApp));
  });
  const required = <T,>(element: T | null): T => {
    if (!element) throw new Error("composer element missing");
    return element;
  };
  return {
    input: required(document.getElementById("message-input") as HTMLTextAreaElement | null),
    form: required(document.getElementById("chat-form") as HTMLFormElement | null),
    abortButton: required(document.getElementById("abort-btn") as HTMLButtonElement | null),
    sendButton: required(document.getElementById("send-btn") as HTMLButtonElement | null),
    composerCard: required(document.getElementById("composer-card") as HTMLElement | null),
    commandButton: required(document.getElementById("command-btn") as HTMLButtonElement | null),
    attachButton: required(document.getElementById("attach-btn") as HTMLButtonElement | null),
    imageInput: required(document.getElementById("image-input") as HTMLInputElement | null),
    imagePreviews: required(document.getElementById("image-previews") as HTMLElement | null),
    skillSlashMenu: required(document.getElementById("skill-slash-menu") as HTMLElement | null),
    queuedMessages: required(document.getElementById("queued-messages") as HTMLElement | null),
    modelDropdown: required(document.getElementById("model-dropdown") as HTMLElement | null),
    modelDropdownBtn: required(
      document.getElementById("model-dropdown-btn") as HTMLButtonElement | null,
    ),
    modelDropdownLabel: required(
      document.getElementById("model-dropdown-label") as HTMLElement | null,
    ),
    modelDropdownMenu: required(document.getElementById("model-dropdown-menu") as HTMLElement | null),
    thinkingBtn: required(document.getElementById("thinking-btn") as HTMLButtonElement | null),
  };
}
