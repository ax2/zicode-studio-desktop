import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OutfitPlan } from "./outfit-types";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

function host() {
  const actions: Record<string, unknown>[] = [];
  let plan: OutfitPlan;
  const settings = {
    baseUrl: "https://images.example.com/v1",
    model: "style-fixture",
    requiresKey: false,
    size: "auto",
    quality: "low",
  };
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as Record<string, unknown>;
    if (request.kind === "list")
      return {
        libraryId: "library",
        page: { assets: [{ id: 1, name: "landscape.png" }], next: null },
      };
    if (request.kind === "preview") return { handle: "preview" };
    if (request.kind === "readPreview") return { mimeType: "image/png", base64: "aW1hZ2U=" };
    const action = request.action as Record<string, unknown>;
    actions.push(action);
    if (action.kind === "settings")
      return { libraryId: "library", settings, credentialConfigured: false };
    if (action.kind === "prepare") {
      plan = {
        workflow: "style",
        libraryId: "library",
        digest: "frozen",
        input: action.input as OutfitPlan["input"],
        settings,
        references: [{ assetId: 1, name: "landscape.png", sha256: "input" }],
        prompt: "Frozen style and preservation brief",
      };
      return { plan };
    }
    if (action.kind === "submit") return {};
    if (action.kind === "status")
      return { job: { id: action.id, plan, state: "ready" }, active: false, archived: null };
    if (action.kind === "preview")
      return { mimeType: "image/png", base64: "aW1hZ2U=", sha256: "output" };
    if (action.kind === "approve") return { assetId: 2 };
    throw new Error(`Unexpected ${action.kind}`);
  });
  return { invoke, actions };
}
async function open(invoke: Invoke) {
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  fireEvent.click(screen.getByRole("button", { name: "Open workflow · Image style transfer" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose from library · Source image" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "landscape.png" }));
}
async function review() {
  fireEvent.click(screen.getByRole("button", { name: "Review style generation" }));
  await screen.findByRole("region", { name: "Confirm style generation" });
}
it("runs style selection, explicit confirmation, comparison and reviewed save", async () => {
  const { invoke, actions } = host();
  await open(invoke);
  expect(screen.queryByRole("button", { name: /Clothing reference/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Style preset"), { target: { value: "ink-wash" } });
  expect((screen.getByLabelText("Style description") as HTMLTextAreaElement).value).toContain(
    "ink wash",
  );
  fireEvent.change(screen.getByLabelText("Style description"), {
    target: { value: "Custom ink brief" },
  });
  fireEvent.change(screen.getByLabelText("Content to preserve"), {
    target: { value: "Keep the bridge" },
  });
  fireEvent.change(screen.getByLabelText("Style strength"), { target: { value: "bold" } });
  await review();
  expect(actions.filter((action) => action.kind === "submit")).toHaveLength(0);
  expect(actions.find((action) => action.kind === "prepare")?.input).toEqual({
    person: 1,
    clothing: null,
    description: "Custom ink brief",
    style: { preset: "ink-wash", revision: 1, strength: "bold", preserve: "Keep the bridge" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm upload and generate styled image" }));
  const preview = await screen.findByAltText("Restyled image");
  const save = screen.getByRole("button", {
    name: "Approve and save styled image",
  }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.load(preview);
  fireEvent.click(save);
  await screen.findByText("Styled image saved to the library. Your original image is unchanged.");
  expect(actions.filter((action) => action.kind === "submit")).toHaveLength(1);
  expect(actions.find((action) => action.kind === "submit")?.confirmed).toBe(true);
  expect(actions.filter((action) => action.kind === "approve")).toHaveLength(1);
});

it("invalidates reviewed consent for every editable style control", async () => {
  const { invoke, actions } = host();
  await open(invoke);
  for (const [label, value] of [
    ["Style strength", "subtle"],
    ["Content to preserve", "Keep the tree"],
    ["Style description", "Edited paint"],
    ["Style preset", "watercolor"],
  ]) {
    await review();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(screen.queryByRole("region", { name: "Confirm style generation" })).toBeNull();
  }
  fireEvent.change(screen.getByLabelText("Style preset"), { target: { value: "custom" } });
  expect(
    (screen.getByRole("button", { name: "Review style generation" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await waitFor(() => expect(actions.filter((action) => action.kind === "submit")).toHaveLength(0));
});
