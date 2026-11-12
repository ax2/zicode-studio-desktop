import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComfyGeneration } from "./ComfyGeneration";
import type { CharacterRequest } from "./useCharacterRecords";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("shows the exact upload destination and reference revision before confirming generation", async () => {
  const attempt = {
    id: "attempt",
    port: 8188,
    state: "submitted",
    outputs: [],
    promptId: "provider-id",
    providerFee: 0,
  };
  let statusChecks = 0;
  const request = vi.fn<CharacterRequest>(async (action) => {
    if (action.kind === "list")
      return {
        attempts: [
          { ...attempt, id: "interrupted", state: "upload_failed", interruptedBeforeSubmit: true },
        ],
      };
    if (action.kind === "plan")
      return {
        token: "token",
        plan: {
          port: 8188,
          budget: { providerFeeLimit: 0 },
          inputs: {
            settings: {
              checkpoint: "fixture.safetensors",
              width: 512,
              height: 512,
              steps: 20,
              cfg: 7,
              seed: "9223372036854775807",
              denoise: 0.75,
            },
            references: [{ assetId: 3, revision: 2, name: "参考.png", sha256: "a".repeat(64) }],
            positive: "角色\n提示词",
            negative: "雾",
          },
        },
      };
    if (action.kind === "confirm") return { attempt };
    if (action.kind === "refresh")
      return {
        attempt: {
          ...attempt,
          state: "ready",
          executionUsage: ++statusChecks === 1 ? null : { startedAtMs: 1000, finishedAtMs: 1321 },
          outputs: [{ filename: "result.png", subfolder: "zicode" }],
        },
      };
    if (action.kind === "output") {
      const review = action.review as { kind: string };
      if (review.kind === "preview") {
        return {
          token: "image-token",
          review: {
            attemptId: "attempt",
            filename: "result.png",
            base64: "cG5n",
            sha256: "b".repeat(64),
          },
        };
      }
      return {
        archived: { filename: "result.png", assetId: 4, revision: 1, sha256: "b".repeat(64) },
      };
    }
    return { cancelled: true };
  });
  render(
    <ComfyGeneration
      characterId="role"
      recipeId="recipe"
      version={2}
      disabled={false}
      request={request}
    />,
  );
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Local ComfyUI generation" }));
  const plan = screen.getByRole<HTMLButtonElement>("button", { name: "Review local generation" });
  await waitFor(() => expect(plan.disabled).toBe(false));
  expect(screen.getByText(/Generation stopped before submission/)).toBeTruthy();
  fireEvent.click(plan);
  await screen.findByText("Generation destination · 127.0.0.1:8188");
  expect(screen.getByText("Local provider fee limit · 0")).toBeTruthy();
  expect(screen.getByText("Local electricity cost · Unavailable")).toBeTruthy();
  expect(screen.getByText(/参考\.png · Revision 2/)).toBeTruthy();
  expect(request).toHaveBeenCalledWith({
    kind: "plan",
    port: 8188,
    selection: { characterId: "role", recipeId: "recipe", version: 2 },
  });
  expect(request.mock.calls.some(([action]) => action.kind === "confirm")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm local generation" }));
  await screen.findByText(/Generation submitted/);
  expect(request).toHaveBeenCalledWith({ kind: "confirm", token: "token" });
  fireEvent.click(screen.getByRole("button", { name: "Check generation status" }));
  await screen.findByText("result.png");
  expect(request).toHaveBeenCalledWith({ kind: "refresh", id: "attempt" });
  expect(screen.getByText("ComfyUI execution time · Unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check execution time" }));
  await screen.findByText("ComfyUI execution time · 321 ms");
  expect(screen.queryByRole("button", { name: "Approve and archive image" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Preview generated image" }));
  const image = await screen.findByRole("img", { name: "result.png" });
  expect(image.getAttribute("src")).toBe("data:image/png;base64,cG5n");
  expect(request).toHaveBeenCalledWith({
    kind: "output",
    review: { kind: "preview", id: "attempt", filename: "result.png" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Approve and archive image" }));
  await screen.findByText("Archived in visual library · #4");
  expect(request).toHaveBeenCalledWith({
    kind: "output",
    review: { kind: "approve", token: "image-token" },
  });
});
