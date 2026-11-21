import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VisionLabels, type VisionRecord } from "./VisionLabels";
vi.mock("../../shared/i18n", () => ({ t: (s: string) => s }));
afterEach(cleanup);
const core = {
  workspaceId: "w",
  sceneId: "s",
  libraryId: "l",
  assetId: 8,
  digest: "d",
  preview: "",
  refresh: vi.fn(),
};
const saved: VisionRecord = {
  id: "old",
  approved: true,
  labels: ["天空"],
  provider: "local",
  model: "v",
  endpointOrigin: "http://localhost",
  previewSha: "abc",
};
it("reviews a chosen subset against the displayed prior approval without sending any new image", async () => {
  const invoke = vi.fn().mockResolvedValue({});
  render(
    <VisionLabels
      {...core}
      invoke={invoke}
      records={[saved, { ...saved, id: "draft", approved: false, labels: ["海滩", "云"] }]}
    />,
  );
  fireEvent.click(screen.getByText(/Image model labels/));
  fireEvent.click(screen.getByRole("checkbox", { name: "海滩" }));
  fireEvent.click(screen.getByText("Apply selected model labels"));
  expect(invoke.mock.calls).toEqual([
    [
      "visual_assets_control",
      {
        workspaceId: "w",
        request: {
          kind: "reviewVision",
          libraryId: "l",
          assetId: 8,
          digest: "d",
          id: "draft",
          selected: ["云"],
          approvedId: "old",
        },
      },
    ],
  ]);
});
it("loads only models explicitly declaring image input and never calls one merely on selection", async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({
      models: [
        { model: "text-only" },
        { provider: "local", model: "vision", endpoint: "http://localhost", supportsImages: true },
      ],
    });
  render(<VisionLabels {...core} invoke={invoke} records={[]} />);
  fireEvent.click(screen.getByText(/Image model labels/));
  fireEvent.click(screen.getByText("Load image models"));
  const select = await screen.findByLabelText("Image model");
  fireEvent.change(select, { target: { value: "0" } });
  expect(screen.queryByText("text-only")).toBeNull();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect((screen.getByText("Review thumbnail transfer") as HTMLButtonElement).disabled).toBe(true);
});
