import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OutfitUsage } from "./OutfitUsage";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("shows supplied breakdown including zero without presenting a bill", () => {
  render(
    <OutfitUsage
      usage={{
        inputTokens: 10,
        textInputTokens: 3,
        imageInputTokens: 7,
        outputTokens: 20,
        textOutputTokens: 0,
        imageOutputTokens: 20,
        totalTokens: 30,
        elapsedMs: 1500,
      }}
    />,
  );
  expect(screen.getByText("Elapsed seconds · 1.5")).toBeTruthy();
  expect(
    screen.getByText("Provider cost is unknown. Check your provider's usage records."),
  ).toBeTruthy();
  for (const [label, value] of [
    ["Text input tokens", "3"],
    ["Image input tokens", "7"],
    ["Text output tokens", "0"],
    ["Image output tokens", "20"],
  ]) {
    const row = screen.getByText(label).parentElement;
    expect(row && within(row).getByText(value)).toBeTruthy();
  }
  expect(screen.getByText("Provider usage details").parentElement?.hasAttribute("open")).toBe(
    false,
  );
});

it("keeps missing breakdown unknown for old saved jobs", () => {
  render(<OutfitUsage usage={{ inputTokens: 10, outputTokens: 20, totalTokens: 30 }} />);
  expect(screen.getByText("Total tokens")).toBeTruthy();
  expect(screen.queryByText("Text input tokens")).toBeNull();
  expect(screen.queryByText("Image input tokens")).toBeNull();
  expect(
    screen.getByText("Reported usage only. Missing values are not zero; this is not a bill."),
  ).toBeTruthy();
});

it("does not fabricate details for absent or unusable usage", () => {
  const view = render(<OutfitUsage />);
  expect(screen.queryByText("Provider usage details")).toBeNull();
  view.rerender(
    <OutfitUsage
      usage={{
        inputTokens: -1,
        imageInputTokens: Number.NaN,
        outputTokens: 0.5,
        totalTokens: Number.MAX_SAFE_INTEGER + 1,
        elapsedMs: null,
      }}
    />,
  );
  expect(screen.queryByText("Provider usage details")).toBeNull();
  expect(
    screen.getByText("Provider cost is unknown. Check your provider's usage records."),
  ).toBeTruthy();
});
