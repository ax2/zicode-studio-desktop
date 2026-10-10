interface ResourceRunner { destroy(): void }
interface Entry { element: HTMLDivElement; runner: ResourceRunner }

// A session owns the trusted DOM/controller; React only supplies its display slot.
export class ResourceSessionOwner {
  private entry: Entry | null = null;
  private fallback: HTMLDivElement | null = null;
  constructor(private onBusy: (busy: boolean) => void) {}

  reportBusy(busy: boolean) { this.onBusy(busy); }

  mount(view: HTMLDivElement, create: (element: HTMLDivElement) => ResourceRunner) {
    this.destroy();
    const element = document.createElement("div");
    element.className = "directory-resource-session";
    view.append(element);
    try { this.entry = { element, runner: create(element) }; }
    catch (error) { element.remove(); throw error; }
    return element;
  }

  release(element: HTMLDivElement) {
    // Error-boundary fallback refs commit before passive effect cleanup. Normal
    // teardown has no fallback; a new mount also invalidates the old entry.
    queueMicrotask(() => {
      if (this.entry?.element === element && !this.fallback) this.destroy();
    });
  }

  showFallback(view: HTMLDivElement | null) {
    this.fallback = view;
    if (view && this.entry) view.append(this.entry.element);
  }

  destroy() {
    const entry = this.entry;
    this.entry = null;
    entry?.runner.destroy();
    entry?.element.remove();
    this.onBusy(false);
  }
}
