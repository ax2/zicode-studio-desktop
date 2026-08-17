// Shared guard for keyboard shortcuts that must not fire while an IME
// (Chinese/Japanese/Korean composition) is in progress. During composition,
// the same physical keys (Enter, Tab, Space, arrows) are used to navigate or
// confirm candidates, so intercepting them would corrupt the input.
//
// `composing` is an optional composing-state ref captured via
// compositionstart/compositionend; it is the most reliable signal, while
// `isComposing` and the legacy `keyCode === 229` sentinel cover synthetic or
// cross-browser key events that do not carry the ref.
export function isImeComposing(
  event: { isComposing?: boolean; keyCode?: number } | null | undefined,
  composing = false,
): boolean {
  return Boolean(event?.isComposing || event?.keyCode === 229 || composing);
}
