import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnimationPanel } from "./AnimationPanel";
import * as caption from "./animation-caption";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("passes one frozen caption to preview and export, and keeps edits when export is cancelled", async () => {
  const draw = vi.spyOn(caption, "rasterizeCaption").mockReturnValue("frozen-glyphs");
  const preview = vi.fn().mockRejectedValue(new Error("end of recording"));
  const send = vi.fn();
  render(
    <AnimationPanel
      libraryId="isolated"
      assets={[{ id: 1, name: "frame" }]}
      disabled={false}
      onExport={send}
      onPreview={preview}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Animation" }));
  fireEvent.change(screen.getByLabelText("Frame image"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
  fireEvent.change(screen.getByLabelText("Meme caption"), {
    target: { value: "早安！\nStudio GIF" },
  });
  fireEvent.change(screen.getByLabelText("Caption placement"), { target: { value: "center" } });
  fireEvent.change(screen.getByLabelText("Caption size"), { target: { value: "large" } });
  fireEvent.change(screen.getByLabelText("Animation export format"), { target: { value: "gif" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose folder and export" }));
  expect(draw).toHaveBeenCalledTimes(1);
  expect(preview.mock.calls[0][0].recipe.caption).toEqual({
    text: "早安！\nStudio GIF",
    position: "center",
    size: "large",
    rasterPng: "frozen-glyphs",
  });
  expect(send.mock.calls[0][0]).toEqual({ ...preview.mock.calls[0][0], format: "gif" });
  expect((screen.getByLabelText("Meme caption") as HTMLTextAreaElement).value).toBe(
    "早安！\nStudio GIF",
  );
  draw.mockReturnValue(null);
  fireEvent.change(screen.getByLabelText("Meme caption"), {
    target: { value: "four\nseparate\ntext\nlines" },
  });
  expect(
    (screen.getByRole("button", { name: "Choose folder and export" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
