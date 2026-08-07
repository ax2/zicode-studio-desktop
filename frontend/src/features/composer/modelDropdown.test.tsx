import { describe, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import {
  createModelDropdownFeed,
  formatModelName,
  type ModelDropdownSnapshot,
} from "./modelDropdown";

const SNAPSHOT: ModelDropdownSnapshot = {
  models: [
    { id: "deepseek-v4-flash", provider: "deepseek", contextWindow: 128000 },
    { id: "gpt-5.2", provider: "openai", contextWindow: 256000 },
  ],
  loading: false,
  error: "",
  currentModelId: "deepseek-v4-flash",
  currentContextWindow: 128000,
};

function makeContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

describe("model dropdown feed", () => {
  it("renders model items with active state", () => {
    const container = makeContainer();
    const callbacks = {
      onSelect: vi.fn(),
      onOpenSettings: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn(),
    };
    const feed = createModelDropdownFeed(container, () => SNAPSHOT, callbacks);
    feed.render();
    expect(container.querySelectorAll(".model-dropdown-item").length).toBe(2);
    expect(container.querySelector(".model-dropdown-item.active")?.textContent).toContain(
      "deepseek-v4-flash",
    );
    expect(container.querySelector(".model-dropdown-search")).toBeTruthy();
  });

  it("renders empty, loading, and error states", () => {
    const container = makeContainer();
    const callbacks = {
      onSelect: vi.fn(),
      onOpenSettings: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn(),
    };
    const empty = createModelDropdownFeed(
      container,
      () => ({ ...SNAPSHOT, models: [] }),
      callbacks,
    );
    empty.render();
    expect(container.querySelector(".model-dropdown-empty-title")?.textContent).toBe(
      t("No models available"),
    );

    const loading = createModelDropdownFeed(
      container,
      () => ({ ...SNAPSHOT, models: [], loading: true }),
      callbacks,
    );
    loading.render();
    expect(container.querySelector(".model-dropdown-empty-title")?.textContent).toBe(
      t("Loading models…"),
    );

    const error = createModelDropdownFeed(
      container,
      () => ({ ...SNAPSHOT, models: [], error: "boom" }),
      callbacks,
    );
    error.render();
    expect(container.querySelector(".model-dropdown-empty-title")?.textContent).toBe(
      t("Models could not be loaded"),
    );
  });

  it("selects a model through the callback", () => {
    const container = makeContainer();
    const onSelect = vi.fn();
    const feed = createModelDropdownFeed(container, () => SNAPSHOT, {
      onSelect,
      onOpenSettings: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn(),
    });
    feed.render();
    (container.querySelectorAll(".model-dropdown-item")[1] as HTMLButtonElement).click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "gpt-5.2" }));
  });

  it("formats model names", () => {
    expect(formatModelName({ id: "claude-sonnet-4-20250805", name: "claude-sonnet-4-20250805" })).toBe(
      "sonnet-4",
    );
  });
});
