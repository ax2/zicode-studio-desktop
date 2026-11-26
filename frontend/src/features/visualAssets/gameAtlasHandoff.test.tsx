import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OutfitInput, OutfitPlan } from "./outfit-types";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2fsAAAAASUVORK5CYII=";
const settings = { baseUrl: "https://fixtures.invalid/v1", model: "fixture", requiresKey: false, size: "auto", quality: "auto" };

function mount({
  listingLibrary = "library",
  historyReceipt,
}: {
  listingLibrary?: string;
  historyReceipt?: unknown;
} = {}) {
  const calls: Record<string, unknown>[] = [];
  let nextAsset = 8;
  let plan: OutfitPlan = {
    libraryId: "library", digest: "digest", prompt: "Stored game asset", workflow: "text-to-image", settings,
    input: { person: null, clothing: null, description: "Stored game asset", generation: { mode: "text", options: {} } },
    references: [],
  };
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    expect(args.workspaceId).toBe("workspace");
    const request = args.request as Record<string, unknown>;
    calls.push(request);
    if (request.kind === "list") {
      return { libraryId: listingLibrary, page: { assets: [], next: 23 }, collections: [] };
    }
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "previewAnimation")
      return { width: 2, height: 3, looped: true, frames: [{ durationMs: 120, base64: image }] };
    if (request.kind === "startAnimation") return { cancelled: true };
    if (request.kind === "preview") return { handle: "known-preview" };
    if (request.kind === "readPreview") return { mimeType: "image/png", base64: image };
    if (request.kind !== "creation") throw Error("Unexpected operation");
    expect(request.sceneId).toBe("scene");
    const action = request.action as Record<string, unknown>;
    if (action.kind === "settings") return { libraryId: "library", settings, credentialConfigured: false };
    if (action.kind === "prepare") {
      const input = action.input as OutfitInput;
      plan = { ...plan, input, prompt: input.description };
      return { plan };
    }
    if (action.kind === "submit") return {};
    if (action.kind === "history") return { entries: [{ id: "history", plan }], next: null };
    if (action.kind === "status") return { job: { id: action.id, state: "ready", plan, created: 1 }, active: false,
      archived: action.id === "history" ? historyReceipt : null };
    if (action.kind === "preview") return { mimeType: "image/png", base64: image, sha256: "digest" };
    if (action.kind === "approve") return { jobId: action.id, assetId: nextAsset++, plan, sha256: "digest" };
    throw Error("Unexpected creation action");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" sceneId="scene" />);
  return { calls };
}

async function openGame() {
  fireEvent.click(screen.getByRole("button", { name: "Open workflow · Game asset creation" }));
  await screen.findByText("Image model settings");
}

async function approveGameImage() {
  await openGame();
  fireEvent.change(screen.getByLabelText("Game asset template"), { target: { value: "icon" } });
  fireEvent.click(screen.getByRole("button", { name: "Review image generation" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm and generate image" }));
  expect(screen.queryByRole("button", { name: "Use as sprite atlas" })).toBeNull();
  fireEvent.load(await screen.findByRole("img", { name: "Generated image" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve and save generated image" }));
  return screen.findByRole("button", { name: "Use as sprite atlas" });
}

it("uses the approved revision from outside the library page to cut and export frames", async () => {
  const { calls } = mount();
  fireEvent.click(await approveGameImage());
  const source = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Animation source" });
  expect(source.value).toBe("atlas");
  const atlas = screen.getByRole<HTMLSelectElement>("combobox", { name: "Atlas image" });
  expect(atlas.value).toBe("8");
  expect(calls.some(({ kind }) => kind === "previewAnimation" || kind === "startAnimation")).toBe(false);
  const add = screen.getByRole<HTMLButtonElement>("button", { name: "Add frame" });
  await waitFor(() => expect(add.disabled).toBe(false));
  fireEvent.click(add);
  fireEvent.change(screen.getByLabelText("Width (px)"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Height (px)"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("Duration (ms)"), { target: { value: "120" } });
  const intent = { libraryId: "library", source: { kind: "atlas", assetId: 8, revision: 1 },
    recipe: { looped: true, frames: [{ x: 0, y: 0, width: 2, height: 3, durationMs: 120, anchorX: 0, anchorY: 0 }] } };
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  expect(await screen.findByRole("img", { name: "Animation preview frame" })).toBeTruthy();
  expect(calls.filter(({ kind }) => kind === "previewAnimation")).toEqual([{ kind: "previewAnimation", intent }]);
  expect(calls.some(({ kind }) => kind === "startAnimation")).toBe(false);
  fireEvent.change(screen.getByLabelText("Animation export format"), { target: { value: "pngSequence" } });
  fireEvent.click(screen.getByRole("button", { name: "Choose folder and export" }));
  await waitFor(() => expect(calls.filter(({ kind }) => kind === "startAnimation")).toEqual([
    { kind: "startAnimation", intent: { ...intent, format: "pngSequence" } },
  ]));

  fireEvent.click(screen.getByRole("button", { name: "Creation home" }));
  fireEvent.click(screen.getByRole("button", { name: "Materials and library" }));
  const animation = await screen.findByRole("button", { name: /^Animation$/ });
  expect(animation.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Creation home" }));
  fireEvent.click(await approveGameImage());
  const nextAtlas = await screen.findByRole<HTMLSelectElement>("combobox", { name: "Atlas image" });
  expect(nextAtlas.value).toBe("9");
  expect(Array.from(nextAtlas.options, ({ value }) => value)).not.toContain("8");
  expect(screen.queryByRole("img", { name: "Animation preview frame" })).toBeNull();
});

it.each([
  { assetId: 8 },
  { assetId: 8, jobId: "history", plan: { libraryId: "replaced-library" } },
  { assetId: 8, jobId: "another-task", plan: { libraryId: "library" } },
])("does not hand off an older receipt missing the current job or library identity", async (historyReceipt) => {
  const { calls } = mount({ historyReceipt });
  await openGame();
  fireEvent.click(screen.getByRole("button", { name: "Load saved image tasks" }));
  fireEvent.click(await screen.findByRole("button", { name: /Stored game asset/ }));
  await screen.findByText("Generated image saved to the library.");
  expect(screen.queryByRole("button", { name: "Use as sprite atlas" })).toBeNull();
  expect(calls.some(({ kind }) => kind === "previewAnimation" || kind === "startAnimation")).toBe(false);
});

it("can use a previously approved result whose stored identity matches the same library", async () => {
  mount({ historyReceipt: { assetId: 8, jobId: "history", plan: { libraryId: "library" } } });
  await openGame();
  fireEvent.click(screen.getByRole("button", { name: "Load saved image tasks" }));
  fireEvent.click(await screen.findByRole("button", { name: /Stored game asset/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Use as sprite atlas" }));
  expect((await screen.findByRole<HTMLSelectElement>("combobox", { name: "Atlas image" })).value).toBe("8");
});

it("drops a handoff when the library loaded after approval has changed", async () => {
  const { calls } = mount({ listingLibrary: "replaced-library" });
  fireEvent.click(await approveGameImage());
  expect(await screen.findByText("The saved image belongs to a different visual library.")).toBeTruthy();
  const animation = screen.getByRole("button", { name: /^Animation$/ });
  expect(animation.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(animation);
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Frame image" }).value).toBe("");
  expect(calls.some(({ kind }) => kind === "previewAnimation" || kind === "startAnimation")).toBe(false);
});
