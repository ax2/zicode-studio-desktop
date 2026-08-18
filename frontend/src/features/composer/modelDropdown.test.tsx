import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
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

  it("exposes the model list with listbox and option roles", () => {
    const container = makeContainer();
    const feed = createModelDropdownFeed(container, () => SNAPSHOT, {
      onSelect: vi.fn(),
      onOpenSettings: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn(),
    });
    feed.render();
    expect(
      container.querySelector(".model-dropdown-items")?.getAttribute("role"),
    ).toBe("listbox");
    expect(
      container.querySelector(".model-dropdown-search")?.getAttribute("role"),
    ).toBe("combobox");
    const active = container.querySelector(".model-dropdown-item.active");
    expect(active?.getAttribute("role")).toBe("option");
    expect(active?.getAttribute("aria-selected")).toBe("true");
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

  it("navigates with arrow keys and selects with Enter", async () => {
    const container = makeContainer();
    const onSelect = vi.fn();
    const feed = createModelDropdownFeed(container, () => SNAPSHOT, {
      onSelect,
      onOpenSettings: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn(),
    });
    feed.render();
    const search = container.querySelector(".model-dropdown-search") as HTMLInputElement;

    fireEvent.keyDown(search, { key: "ArrowDown" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector(".model-dropdown-item.selected")?.textContent).toContain(
      "gpt-5.2",
    );

    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "gpt-5.2" }));
  });

  it("does not select a model while an IME composition is in progress", () => {
    const container = makeContainer();
    const onSelect = vi.fn();
    const feed = createModelDropdownFeed(container, () => SNAPSHOT, {
      onSelect,
      onOpenSettings: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn(),
    });
    feed.render();
    const search = container.querySelector(
      ".model-dropdown-search",
    ) as HTMLInputElement;

    search.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clears the search filter with the clear button", async () => {
    const container = makeContainer();
    const feed = createModelDropdownFeed(container, () => SNAPSHOT, {
      onSelect: vi.fn(),
      onOpenSettings: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn(),
    });
    feed.render();
    const search = container.querySelector(
      ".model-dropdown-search",
    ) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "gpt" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const clear = container.querySelector(
      ".model-dropdown-clear",
    ) as HTMLButtonElement;
    expect(clear).toBeTruthy();
    clear.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      (container.querySelector(".model-dropdown-search") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(container.querySelector(".model-dropdown-clear")).toBeNull();
  });

  it("formats model names", () => {
    expect(formatModelName({ id: "claude-sonnet-4-20250805", name: "claude-sonnet-4-20250805" })).toBe(
      "sonnet-4",
    );
  });
});
