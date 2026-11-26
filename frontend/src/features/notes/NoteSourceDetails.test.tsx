import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getLocale, setLocale, t } from "../../shared/i18n";
import { NoteSourceDetails } from "./NoteSourceDetails";

const originalLocale = getLocale();
const source = { url: "https://example.invalid/article" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setLocale(originalLocale);
});

it("shows the captured source, attribution and dates", () => {
  setLocale("zh-CN");
  const view = render(
    <NoteSourceDetails source={{
      ...source,
      siteName: "Example Site",
      author: "Alice",
      publishedAt: "2026-07-30T00:00:00Z",
      capturedAt: "2026-07-31T08:00:00Z",
    }} />,
  );
  const link = view.getByRole("link", { name: source.url });
  expect(link.getAttribute("href")).toBe(source.url);
  expect(view.getByText("Example Site · Alice")).toBeTruthy();
  expect(view.getByText(/^发布于/)).toBeTruthy();
  expect(view.getByText(/^剪藏于/)).toBeTruthy();
});

it.each(["javascript:void(0)", "https://user:pass@example.invalid/"])(
  "renders an unsafe source as plain text: %s",
  (url) => {
    const view = render(<NoteSourceDetails source={{ url }} />);
    expect(view.queryByRole("link", { name: url })).toBeNull();
    expect(view.getByText((_text, node) => node?.tagName === "P" && node.textContent?.includes(url) === true)).toBeTruthy();
  },
);

it("copies the original source URL", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
  const view = render(<NoteSourceDetails source={source} />);
  const copy = view.getByRole("button", { name: t("Copy source URL") });
  fireEvent.click(copy);
  await waitFor(() => expect(copy.textContent).toBe(t("Copied")));
  expect(writeText).toHaveBeenCalledWith(source.url);
});

it("shows a failure when copying the source URL is rejected", async () => {
  const writeText = vi.fn(async () => {
    throw new Error("denied");
  });
  vi.stubGlobal("navigator", { ...globalThis.navigator, clipboard: { writeText } });
  const view = render(<NoteSourceDetails source={source} />);
  const copy = view.getByRole("button", { name: t("Copy source URL") });
  fireEvent.click(copy);
  await waitFor(() => expect(copy.textContent).toBe(t("Copy failed")));
});
