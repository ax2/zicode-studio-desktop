import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnimationPanel } from "./AnimationPanel";
import { AnimationPlayback } from "./AnimationPlayback";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const intent = {
  libraryId: "library",
  source: { kind: "sequence" as const },
  recipe: { looped: true, frames: [{ assetId: 1, revision: 1, durationMs: 120 }] },
};
const frames = [
  { durationMs: 120, base64: "iVBORw0KGgoA" },
  { durationMs: 245, base64: "iVBORw0KGgoB" },
];

async function start(looped: boolean) {
  const onPreview = vi.fn(async () => ({ width: 5, height: 4, looped, frames }));
  render(<AnimationPlayback intent={intent} disabled={false} onPreview={onPreview} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  const image = await screen.findByRole("img", { name: "Animation preview frame" });
  expect(onPreview).toHaveBeenCalledWith(intent);
  return image;
}

it("uses the frame durations, loops, pauses and steps through frames", async () => {
  const image = await start(true);
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const advance = (ms: number) => {
    now += ms;
    act(() => vi.advanceTimersByTime(ms));
  };
  fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
  advance(119);
  expect(image.getAttribute("src")).toContain(frames[0].base64);
  advance(1);
  expect(image.getAttribute("src")).toContain(frames[1].base64);
  advance(245);
  expect(image.getAttribute("src")).toContain(frames[0].base64);
  fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));
  advance(500);
  expect(image.getAttribute("src")).toContain(frames[0].base64);
  fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
  expect(image.getAttribute("src")).toContain(frames[1].base64);
});

it("stops a single play at the last frame and replays from the beginning", async () => {
  const image = await start(false);
  vi.useFakeTimers();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
  now = 365;
  act(() => vi.advanceTimersByTime(365));
  expect(image.getAttribute("src")).toContain(frames[1].base64);
  fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
  expect(image.getAttribute("src")).toContain(frames[0].base64);
});

it("drops an in-flight preview when the draft changes", async () => {
  let resolve: (value: unknown) => void = () => {};
  const onPreview = vi.fn(
    () =>
      new Promise<unknown>((done) => {
        resolve = done;
      }),
  );
  render(
    <AnimationPanel
      assets={[{ id: 1, name: "image.png" }]}
      libraryId="library"
      disabled={false}
      onExport={vi.fn()}
      onPreview={onPreview}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Animation" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Frame image" }), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  expect(screen.getByRole("status").textContent).toBe("Preparing animation preview...");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Duration (ms)" }), {
    target: { value: "200" },
  });
  await act(async () => resolve({ width: 5, height: 4, looped: true, frames }));
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Generate preview" }).disabled).toBe(
    false,
  );
});
