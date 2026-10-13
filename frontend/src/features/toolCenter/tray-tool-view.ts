export type ToolDirectoryView = "all" | "favorites" | "recent";

function validView(value: unknown): value is ToolDirectoryView {
  return value === "favorites" || value === "recent";
}

export function initialTrayToolView(): ToolDirectoryView {
  const requested = new URLSearchParams(globalThis.location?.search ?? "").get("toolView");
  return validView(requested) ? requested : "all";
}

export function subscribeTrayToolView(select: (view: ToolDirectoryView) => void): () => void {
  const onView = (event: Event) => {
    const requested = (event as CustomEvent<unknown>).detail;
    if (validView(requested)) select(requested);
  };
  window.addEventListener("zicode:tool-view", onView);
  return () => window.removeEventListener("zicode:tool-view", onView);
}
