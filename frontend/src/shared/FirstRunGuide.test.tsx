import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FirstRunGuide } from "./FirstRunGuide";
import { setLocale } from "./i18n";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: Storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
    clear: vi.fn(() => data.clear()),
    key: vi.fn((index: number) => [...data.keys()][index] ?? null),
    get length() {
      return data.size;
    },
  };
  return storage;
}

afterEach(() => {
  document.body.innerHTML = "";
  setLocale("zh-CN");
});

describe("FirstRunGuide", () => {
  it("renders steps and fires the call-to-action", () => {
    setLocale("en");
    const onCta = vi.fn();
    render(
      <FirstRunGuide
        storageKey="demo"
        title="How it works"
        steps={["First step", "Second step"]}
        ctaLabel="Start"
        onCta={onCta}
        storage={memoryStorage()}
      />,
    );
    expect(screen.getByText("How it works")).toBeTruthy();
    expect(screen.getByText("First step")).toBeTruthy();
    fireEvent.click(screen.getByText("Start"));
    expect(onCta).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("How it works")).toBeNull();
  });

  it("stays hidden once dismissed", () => {
    setLocale("en");
    const storage = memoryStorage({ "zicode.first-run.dismissed.demo": "1" });
    render(
      <FirstRunGuide
        storageKey="demo"
        title="How it works"
        steps={["First step"]}
        ctaLabel="Start"
        onCta={() => {}}
        storage={storage}
      />,
    );
    expect(screen.queryByText("How it works")).toBeNull();
  });
});
