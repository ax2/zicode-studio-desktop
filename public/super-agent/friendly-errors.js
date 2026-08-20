// Shared friendly mapping for background task dispatch failures.
//
// Raw client-side JavaScript errors (a forgotten import, a stale bundle
// TypeError) are meaningless to end users. Every surface that renders a task
// failReason — the Task center, automation run history, and the Agent Inbox
// runtime panel — should route the reason through `friendlyTaskDispatchError`
// so the user sees a retry prompt instead of an identifier name.
import { t } from "../i18n.js";

const INTERNAL_DISPATCH_ERROR =
  /(?:is not defined|ReferenceError|TypeError|SyntaxError|undefined is not a function|cannot read properties of (?:undefined|null)|unexpected token)/i;

export function friendlyTaskDispatchError(reason) {
  if (!reason) return "";
  return INTERNAL_DISPATCH_ERROR.test(reason)
    ? t("Task dispatch failed due to an internal error")
    : reason;
}
