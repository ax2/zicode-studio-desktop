import {
  type DialogOption,
  parseDialogContent,
  parseOption,
} from "../dialog/dialogLogic";

export const MULTI_SELECT_HINT = "Enter the numbers of all that apply";
export const CUSTOM_ANSWER_HINT = "Type your answer";

export type {
  DialogContent,
  DialogOption,
} from "../dialog/dialogLogic";

export function parseOptionsFromBody(body: string): DialogOption[] {
  return String(body)
    .split("\n")
    .map((line) => parseOption(line.trim()))
    .filter((option) => option.number);
}

export function isTypeSomethingOption(option: DialogOption): boolean {
  return option.label.replace(/\.$/, "").toLowerCase() === "type something";
}

export function isCustomAnswerInput(content: {
  title: string;
  body: string;
}): boolean {
  return (
    content.title.includes(CUSTOM_ANSWER_HINT) ||
    content.body.includes(CUSTOM_ANSWER_HINT)
  );
}

export interface InlinePromptRequest {
  type?: string;
  method?: string;
  id?: string;
  title?: string;
  message?: string;
  options?: unknown[];
  prefill?: string;
  placeholder?: string;
}

export function isInlineAskUserQuestionRequest(
  request: InlinePromptRequest | undefined | null,
  hasPendingCustomAnswers = false,
): boolean {
  if (request?.type !== "extension_ui_request") return false;
  if (request.method === "select") {
    const options = request.options ?? [];
    return options.length > 0 && options.every((option) => parseOption(option).number);
  }
  if (request.method !== "input") return false;
  const content = parseDialogContent(request);
  if (isCustomAnswerInput(content) && hasPendingCustomAnswers) return true;
  return Boolean(
    content.header &&
      (content.body.includes(MULTI_SELECT_HINT) ||
        content.title.includes(CUSTOM_ANSWER_HINT) ||
        content.body.includes(CUSTOM_ANSWER_HINT)),
  );
}

export { parseDialogContent, parseOption };
