import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreationSource } from "./CreationSource";
import { basicCapabilities, type ImageCapabilities } from "./generation-types";
import { OutfitWorkspace } from "./OutfitWorkspace";
import type { ImageSettings, OutfitInput, OutfitPlan } from "./outfit-types";
import type { ImageSpecifications } from "./OutputSpecifications";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const capabilities: ImageCapabilities = {
  profile: "gpt-image-26-v1",
  source: "built-in",
  sizes: ["auto", "1024x1024", "1536x1024", "1024x1536"],
  qualities: ["auto", "low", "medium", "high"],
  formats: ["png", "jpeg", "webp"],
  backgrounds: ["auto", "opaque", "transparent"],
  complexities: ["low", "medium", "high"],
  compression: true,
};
const settings: ImageSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-image-2.6-flare",
  requiresKey: false,
  size: "auto",
  quality: "low",
};
function host(
  caps = capabilities,
  ready = false,
  statusError?: () => string | undefined,
  specifications?: ImageSpecifications | null,
) {
  const actions: Record<string, unknown>[] = [];
  const libraryActions: string[] = [];
  let plan: OutfitPlan;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as Record<string, unknown>;
    if (request.kind !== "creation") {
      libraryActions.push(request.kind as string);
      if (request.kind === "list")
        return {
          libraryId: "library",
          page: { assets: [{ id: 7, name: "reference.png" }], next: null },
        };
      if (request.kind === "preview") return { handle: "reference-preview" };
      if (request.kind === "readPreview") return { mimeType: "image/png", base64: "aW1hZ2U=" };
      throw new Error("unexpected library action");
    }
    const action = request.action as Record<string, unknown>;
    actions.push(action);
    if (action.kind === "settings")
      return { libraryId: "library", settings, credentialConfigured: false, capabilities: caps };
    if (action.kind === "saveSettings")
      return {
        settings: action.settings,
        credentialConfigured: false,
        capabilities: basicCapabilities,
      };
    if (action.kind === "prepare") {
      const input = action.input as OutfitInput;
      plan = {
        settings,
        input,
        workflow: input.generation?.mode === "text" ? "text-to-image" : "image-to-image",
        libraryId: "library",
        digest: "digest",
        prompt: input.description,
        references: input.person
          ? [{ assetId: 7, name: "reference.png", sha256: "reference" }]
          : [],
      };
      return { plan };
    }
    if (action.kind === "submit") {
      if (!ready) throw new Error("receipt lost");
      return {};
    }
    if (action.kind === "status") {
      const error = statusError?.();
      if (error) throw error;
      return {
        job: { id: action.id, state: ready ? "ready" : "unknown", plan, created: 1 },
        active: false,
        archived: null,
      };
    }
    if (action.kind === "preview")
      return {
        mimeType: "image/png", base64: "aW1hZ2U=", sha256: "result",
        ...(action.inspect ? { specifications } : {}),
      };
    if (action.kind === "approve") return { assetId: 8 };
    throw new Error(`unexpected ${action.kind}`);
  });
  return { invoke, actions, libraryActions };
}
async function describe() {
  fireEvent.change(await screen.findByLabelText("Describe the image to create"), {
    target: { value: "A small forest cabin" },
  });
}
async function review() {
  fireEvent.click(screen.getByRole("button", { name: "Review image generation" }));
  return await screen.findByRole("region", { name: "Confirm image generation" });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("recovers the first status after a short library lock without resubmitting", async () => {
  let locked = true;
  const h = host(capabilities, true, () => (locked ? "visual_assets_busy" : undefined));
  render(<OutfitWorkspace invoke={h.invoke} workspaceId="workspace" workflow="generate" />);
  await describe();
  await review();

  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and generate image" }));
  await advance(0);
  expect(h.actions.filter(({ kind }) => kind === "status")).toHaveLength(1);
  await advance(450);
  expect(screen.queryByRole("alert")).toBeNull();
  locked = false;
  await advance(1500);
  expect(screen.getByRole("img", { name: "Generated image" })).toBeTruthy();
  const submitted = h.actions.filter(({ kind }) => kind === "submit");
  expect(submitted).toHaveLength(1);
  const reads = h.actions.filter(({ kind }) => kind === "status");
  expect(reads.length).toBeGreaterThan(1);
  expect(reads.every(({ id }) => id === submitted[0].id)).toBe(true);
  expect(h.actions.filter(({ kind }) => kind === "preview")).toHaveLength(1);
  expect(h.actions.some(({ kind }) => kind === "approve")).toBe(false);
});

it("stops reading a busy task after navigating out of its workflow", async () => {
  const h = host(capabilities, true, () => "visual_assets_busy");
  function workspace(workflow: "generate" | "style") {
    return <OutfitWorkspace invoke={h.invoke} workspaceId="workspace" workflow={workflow} />;
  }
  const view = render(workspace("generate"));
  await describe();
  await review();

  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and generate image" }));
  await advance(0);
  const reads = () => h.actions.filter(({ kind }) => kind === "status");
  expect(reads()).toHaveLength(1);
  view.rerender(workspace("style"));
  await advance(10000);
  expect(reads()).toHaveLength(1);
  expect(h.actions.filter(({ kind }) => kind === "submit")).toHaveLength(1);
});

it("reports a persistent library lock and lets a manual refresh read the same task", async () => {
  let locked = true;
  const h = host(capabilities, true, () => (locked ? "visual_assets_busy" : undefined));
  render(<OutfitWorkspace invoke={h.invoke} workspaceId="workspace" workflow="generate" />);
  await describe();
  await review();

  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and generate image" }));
  await advance(0);
  await advance(10000);
  expect(screen.getByRole("alert").textContent).toContain("Another image task");
  const reads = () => h.actions.filter(({ kind }) => kind === "status");
  const completedReads = reads().length;
  expect(completedReads).toBeGreaterThan(2);
  await advance(10000);
  expect(reads()).toHaveLength(completedReads);

  locked = false;
  fireEvent.click(screen.getByRole("button", { name: "Refresh generation status" }));
  await advance(0);
  expect(screen.getByRole("img", { name: "Generated image" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  const submitted = h.actions.filter(({ kind }) => kind === "submit");
  expect(submitted).toHaveLength(1);
  expect(reads().every(({ id }) => id === submitted[0].id)).toBe(true);
});

it("opens text generation from the business home without reading images and never retries a lost receipt", async () => {
  const h = host();
  render(<VisualAssetsApp invoke={h.invoke} workspaceId="workspace" />);
  fireEvent.click(screen.getByRole("button", { name: "Open workflow · Generate images" }));
  await describe();
  expect(screen.queryByRole("button", { name: /Choose from library/ })).toBeNull();
  const firstReview = await review();
  expect(within(firstReview).getByText(/No reference image will be uploaded/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Image quality"), { target: { value: "medium" } });
  expect(screen.queryByRole("region", { name: "Confirm image generation" })).toBeNull();
  expect(h.actions.some((action) => action.kind === "submit")).toBe(false);
  await review();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and generate image" }));
  await screen.findByText(/generation outcome is unknown/);
  fireEvent.click(screen.getByRole("button", { name: "Refresh generation status" }));
  await waitFor(() =>
    expect(h.actions.filter((action) => action.kind === "status")).toHaveLength(2),
  );
  expect(h.actions.filter((action) => action.kind === "submit")).toHaveLength(1);
  const input = h.actions.filter((action) => action.kind === "prepare").at(-1)
    ?.input as OutfitInput;
  expect(input).toEqual({
    person: null,
    clothing: null,
    description: "A small forest cabin",
    generation: { mode: "text", options: { size: "auto", quality: "medium", format: "png" } },
  });
  expect(h.libraryActions).toEqual([]);
});

it("opens a game asset template, reviews the edited brief, and saves only after approval", async () => {
  const h = host(basicCapabilities, true);
  render(<VisualAssetsApp invoke={h.invoke} workspaceId="workspace" sceneId="creative" />);
  fireEvent.click(screen.getByRole("button", { name: "Open workflow · Game asset creation" }));
  const template = screen.getByLabelText<HTMLSelectElement>("Game asset template");
  const brief = screen.getByLabelText<HTMLTextAreaElement>("Game asset brief");
  const prepare = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Review image generation",
  });
  expect(brief.disabled).toBe(true);
  expect(prepare.disabled).toBe(true);
  for (const [id, title, text] of [
    ["character", "Game character", "neutral full-body pose"],
    ["prop", "Game prop", "three-quarter view"],
    ["scene", "Game scene", "clear focal point"],
    ["icon", "Game UI icon", "simple silhouette"],
  ]) {
    fireEvent.change(template, { target: { value: id } });
    expect(template.selectedOptions[0].textContent).toBe(title);
    expect(brief.value).toContain(text);
  }
  expect(screen.queryByLabelText("Image background")).toBeNull();
  expect(h.actions.some(({ kind }) => kind === "prepare" || kind === "submit")).toBe(false);
  const edited = "A gold shield icon with a single blue gem";
  fireEvent.change(brief, { target: { value: edited } });
  const textReview = await review();
  expect(within(textReview).getByText(edited)).toBeTruthy();
  expect(within(textReview).getByText(/No reference image will be uploaded/)).toBeTruthy();
  expect(h.actions.filter(({ kind }) => kind === "prepare")[0]?.input).toEqual({
    person: null,
    clothing: null,
    description: edited,
    generation: { mode: "text", options: {} },
  });
  fireEvent.change(template, { target: { value: "prop" } });
  expect(screen.queryByRole("region", { name: "Confirm image generation" })).toBeNull();
  fireEvent.change(template, { target: { value: "icon" } });
  expect(brief.value).toBe(edited);
  expect(h.actions.some(({ kind }) => kind === "submit")).toBe(false);

  fireEvent.change(screen.getByLabelText("Generation mode"), { target: { value: "image" } });
  expect(prepare.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Choose from library · Source image" }));
  fireEvent.click(await screen.findByRole("button", { name: "reference.png" }));
  const imageReview = await review();
  expect(within(imageReview).getByText(/reference\.png/)).toBeTruthy();
  expect(h.actions.some(({ kind }) => kind === "submit")).toBe(false);
  fireEvent.click(within(imageReview).getByRole("button", { name: "Confirm upload and generate image" }));
  const approve = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Approve and save generated image",
  });
  const [submission] = h.actions.filter(({ kind }) => kind === "submit");
  expect(submission).toMatchObject({
    confirmed: true,
    digest: "digest",
    input: {
      person: 7,
      clothing: null,
      description: edited,
      generation: { mode: "image", options: {} },
    },
  });
  expect(h.actions.filter(({ kind }) => kind === "submit")).toHaveLength(1);
  expect(approve.disabled).toBe(true);
  expect(h.actions.some(({ kind }) => kind === "approve")).toBe(false);
  fireEvent.load(screen.getByRole("img", { name: "Generated image" }));
  fireEvent.click(approve);
  await screen.findByText("Generated image saved to the library.");
  expect(h.actions.filter(({ kind }) => kind === "approve")).toEqual([
    { kind: "approve", id: submission.id, sha256: "result" },
  ]);
});

it.each([
  { name: "matching", format: "png", width: 1024, height: 1024, hasTransparency: true },
  { name: "mismatched", format: "jpeg", width: 512, height: 384, hasTransparency: false },
  { name: "unknown", format: null, width: 0, height: 0, hasTransparency: false },
] as const)("shows $name game asset specifications before separate approval", async (specimen) => {
  const { format, width, height, hasTransparency } = specimen;
  const h = host(capabilities, true, undefined, format ? { format, width, height, hasTransparency } : null);
  render(<OutfitWorkspace invoke={h.invoke} workspaceId="workspace" workflow="game" />);
  fireEvent.change(screen.getByLabelText("Game asset template"), { target: { value: "icon" } });
  fireEvent.change(await screen.findByLabelText("Image size"), { target: { value: "1024x1024" } });
  fireEvent.change(screen.getByLabelText("Image background"), { target: { value: "transparent" } });
  await review();
  expect(screen.queryByText("Original image size")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and generate image" }));
  const approve = await screen.findByRole<HTMLButtonElement>("button", { name: "Approve and save generated image" });
  expect(approve.disabled).toBe(true);
  const [submitted] = h.actions.filter(({ kind }) => kind === "submit");
  expect(h.actions.filter(({ kind }) => kind === "preview")).toEqual([
    { kind: "preview", id: submitted.id, inspect: true },
  ]);
  fireEvent.load(screen.getByRole("img", { name: "Generated image" }));
  expect(approve.disabled).toBe(false);
  if (format) {
    const actual = screen.getByLabelText("Actual image output");
    expect(within(actual).getByText(`${width} × ${height} px`)).toBeTruthy();
    expect(within(actual).getByText(format.toUpperCase())).toBeTruthy();
    expect(within(actual).getByText(hasTransparency ? "Contains transparent or translucent pixels" : "All pixels are opaque")).toBeTruthy();
  } else {
    expect(screen.getByText("Original image specifications could not be read.")).toBeTruthy();
  }
  const mismatch = specimen.name === "mismatched";
  expect(Boolean(screen.queryByText("Actual dimensions differ from the requested size."))).toBe(mismatch);
  expect(Boolean(screen.queryByText("Actual transparency differs from the requested background."))).toBe(mismatch);
  expect(h.actions.some(({ kind }) => kind === "approve")).toBe(false);
  fireEvent.click(approve);
  await screen.findByText("Generated image saved to the library.");
  expect(h.actions.filter(({ kind }) => kind === "approve")).toEqual([
    { kind: "approve", id: submitted.id, sha256: "result" },
  ]);
});

it("requires a selected image in edit mode and clears that selection when modes change", async () => {
  const h = host();
  render(<OutfitWorkspace invoke={h.invoke} workspaceId="workspace" workflow="generate" />);
  await describe();
  fireEvent.change(screen.getByLabelText("Generation mode"), { target: { value: "image" } });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Review image generation" }).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Choose from library · Source image" }));
  fireEvent.click(await screen.findByRole("button", { name: "reference.png" }));
  await review();
  expect(screen.getByRole("button", { name: "Confirm upload and generate image" })).toBeTruthy();
  const input = h.actions.find((action) => action.kind === "prepare")?.input as OutfitInput;
  expect(input.person).toBe(7);
  expect(input.generation?.mode).toBe("image");
  fireEvent.change(screen.getByLabelText("Generation mode"), { target: { value: "text" } });
  expect(screen.queryByRole("region", { name: "Confirm image generation" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Generation mode"), { target: { value: "image" } });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Review image generation" }).disabled,
  ).toBe(true);
});

it("keeps format combinations valid and saves a text result only after its preview loads", async () => {
  const h = host(capabilities, true);
  render(<OutfitWorkspace invoke={h.invoke} workspaceId="workspace" workflow="generate" />);
  await describe();
  fireEvent.change(screen.getByLabelText("Image background"), { target: { value: "transparent" } });
  fireEvent.change(screen.getByLabelText("Output image format"), { target: { value: "jpeg" } });
  expect(screen.getByLabelText<HTMLSelectElement>("Image background").value).toBe("opaque");
  fireEvent.change(screen.getByLabelText("Output compression (0–100)"), {
    target: { value: "85" },
  });
  fireEvent.change(screen.getByLabelText("Output image format"), { target: { value: "png" } });
  expect(screen.queryByLabelText("Output compression (0–100)")).toBeNull();
  fireEvent.change(screen.getByLabelText("Output image format"), { target: { value: "webp" } });
  await review();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and generate image" }));
  const approve = await screen.findByRole<HTMLButtonElement>("button", {
    name: "Approve and save generated image",
  });
  expect(approve.disabled).toBe(true);
  expect(h.libraryActions).toEqual([]);
  fireEvent.load(screen.getByRole("img", { name: "Generated image" }));
  fireEvent.click(approve);
  await screen.findByText("Generated image saved to the library.");
  expect(h.actions.filter((action) => action.kind === "approve")).toEqual([
    { kind: "approve", id: expect.any(String), sha256: "result" },
  ]);
  const input = h.actions.find((action) => action.kind === "prepare")?.input as OutfitInput;
  expect(input.generation?.options.compression).toBeUndefined();
  expect(input.generation?.options.format).toBe("webp");
});

it("hides unregistered parameters and clears a declared profile when the endpoint changes", async () => {
  const h = host(basicCapabilities);
  render(<OutfitWorkspace invoke={h.invoke} workspaceId="workspace" workflow="generate" />);
  await describe();
  expect(screen.queryByLabelText("Image quality")).toBeNull();
  expect(screen.queryByLabelText("Output image format")).toBeNull();
  await review();
  const input = h.actions.find((action) => action.kind === "prepare")?.input as OutfitInput;
  expect(input.generation?.options).toEqual({});
  fireEvent.click(screen.getByText("Image model settings"));
  fireEvent.change(screen.getByLabelText("Image API compatibility"), {
    target: { value: "gpt-image-26-v1" },
  });
  expect(screen.queryByRole("region", { name: "Confirm image generation" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Image API base URL"), {
    target: { value: "https://images.example.com/v1" },
  });
  expect(screen.getByLabelText<HTMLSelectElement>("Image API compatibility").value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Save image model settings" }));
  await waitFor(() =>
    expect(h.actions.some((action) => action.kind === "saveSettings")).toBe(true),
  );
  expect(
    (h.actions.find((action) => action.kind === "saveSettings")?.settings as ImageSettings)
      .capabilityProfile,
  ).toBeUndefined();
});

it("reads a restored text generation source and its parameters without requiring a reference image", async () => {
  const invoke = vi.fn<Invoke>(async () => ({
    plan: {
      settings,
      workflow: "text-to-image",
      input: {
        person: null,
        clothing: null,
        description: "A forest",
        generation: { mode: "text", options: { format: "webp", quality: "low" } },
      },
      references: [],
      prompt: "A forest",
      digest: "digest",
      libraryId: "restored",
    },
  }));
  render(
    <CreationSource invoke={invoke} workspaceId="workspace" id="saved" libraryId="restored" />,
  );
  fireEvent.click(screen.getByText("Image generation source"));
  fireEvent.click(screen.getByRole("button", { name: "Read saved image source" }));
  await screen.findByText("Text to image");
  expect(screen.getByText("webp")).toBeTruthy();
  expect(invoke).toHaveBeenCalledTimes(1);
});
