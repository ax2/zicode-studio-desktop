import { useCallback, useEffect, useRef } from "react";

export function useQuickToolMenu(compact: boolean, launcher = false) {
  const ref = useRef<HTMLDetailsElement>(null);
  const dismiss = useCallback((restoreFocus = true) => {
    const menu = ref.current;
    if (!menu?.open) return;
    menu.open = false;
    if (restoreFocus) menu.querySelector("summary")?.focus();
  }, []);
  useEffect(() => {
    const menu = ref.current;
    if (!compact || !menu) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && menu.open) {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const summary = menu.querySelector("summary");
      if (!menu.open && event.target !== summary) return;
      const input = event.target instanceof HTMLInputElement;
      if (launcher && input && (event.key === "Home" || event.key === "End")) return;
      const selector = launcher ? "[data-tool-launcher-open]" : "button:not(:disabled)";
      const buttons = [...menu.querySelectorAll<HTMLButtonElement>(selector)];
      if (launcher && !menu.open) {
        event.preventDefault();
        menu.open = true;
        return;
      }
      if (launcher && !input && event.target !== summary && !buttons.includes(event.target as HTMLButtonElement)) return;
      if (!buttons.length) return;
      event.preventDefault();
      menu.open = true;
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : event.key === "ArrowDown" ? (index + 1) % buttons.length
        : index <= 0 ? buttons.length - 1 : index - 1;
      buttons[next].focus();
    };
    const outside = (event: Event) => {
      if (event.target instanceof Node && !menu.contains(event.target)) dismiss(false);
    };
    const targetChanged = () => dismiss(menu.contains(document.activeElement));
    const blur = () => dismiss(false);
    menu.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("zicode:tool-target-changed", targetChanged);
    window.addEventListener("blur", blur);
    return () => {
      menu.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("zicode:tool-target-changed", targetChanged);
      window.removeEventListener("blur", blur);
    };
  }, [compact, dismiss, launcher]);
  return { ref, dismiss };
}
