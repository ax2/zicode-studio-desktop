import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { InlineExtensionPromptCard } from "./InlineExtensionPromptApp";
import {
  type InlinePromptRequest,
  isCustomAnswerInput,
  isInlineAskUserQuestionRequest,
  parseDialogContent,
} from "./inlineExtensionPromptLogic";

export {
  isInlineAskUserQuestionRequest,
  parseOptionsFromBody,
} from "./inlineExtensionPromptLogic";

const pendingCustomAnswers: string[] = [];

export interface InlinePromptResult {
  value?: unknown;
  cancelled?: boolean;
}

export function showInlineExtensionPrompt(
  request: InlinePromptRequest,
  {
    container = document.getElementById("messages"),
    dismissSignal,
  }: {
    container?: HTMLElement | null;
    dismissSignal?: Promise<unknown>;
  } = {},
): Promise<InlinePromptResult> | null {
  if (!container || !isInlineAskUserQuestionRequest(request, pendingCustomAnswers.length > 0)) {
    return null;
  }
  const content = parseDialogContent(request);
  if (
    request.method === "input" &&
    isCustomAnswerInput(content) &&
    pendingCustomAnswers.length > 0
  ) {
    return Promise.resolve({ value: pendingCustomAnswers.shift() });
  }
  container.querySelector(".welcome")?.remove();
  return new Promise((resolve) => {
    const wrapper = document.createElement("div");
    wrapper.dataset.inlinePromptRoot = "";
    container.append(wrapper);
    let root: Root | null = null;
    flushSync(() => {
      root = createRoot(wrapper);
      root.render(
        createElement(InlineExtensionPromptCard, {
          request,
          content,
          dismissSignal,
          onSettle: (result) => {
            resolve(result);
          },
          onCustomAnswer: (value) => {
            pendingCustomAnswers.push(value);
          },
        }),
      );
    });
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  });
}
