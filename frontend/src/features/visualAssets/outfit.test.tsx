import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssetLibrary } from "./AssetLibrary";
import { OutfitTask } from "./OutfitTask";
import { OutfitWorkspace } from "./OutfitWorkspace";
import type { OutfitPlan } from "./outfit-types";
import type { Invoke } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("restores quota rejection and refreshes without sending another paid request", async () => {
  const request = vi.fn(async () => ({
    job: {
      id: "quota-job",
      state: "rejected",
      error: "visual_assets_creation_quota_exhausted",
      created: 1,
    },
    active: false,
    archived: null,
  }));
  render(<OutfitTask id="quota-job" request={request} library={vi.fn()} libraryId="library" />);
  await screen.findByText(/image service has no available quota/);
  fireEvent.click(screen.getByRole("button", { name: "Refresh generation status" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls).toEqual([
    [{ kind: "status", id: "quota-job" }],
    [{ kind: "status", id: "quota-job" }],
  ]);
});

it("reads the restored library's generation source without the original local task database", async () => {
  const actions: Record<string, unknown>[] = [];
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as Record<string, unknown>;
    if (request.kind === "list")
      return {
        libraryId: "restored-library",
        page: {
          assets: [
            { id: 2, name: "Outfit result.png", digest: "hash", creationJobId: "archived-job" },
          ],
          next: null,
        },
      };
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "creation") {
      actions.push(request.action as Record<string, unknown>);
      return { plan, usage: { inputTokens: 10, textInputTokens: 3, imageInputTokens: 7 } };
    }
    throw "preview unavailable";
  });
  render(<AssetLibrary invoke={invoke} workspaceId="new-workspace" />);
  fireEvent.click(await screen.findByText("Image generation source"));
  fireEvent.click(screen.getByRole("button", { name: "Read saved image source" }));
  await screen.findByText("Frozen blue jacket prompt");
  expect(screen.getByText("Image input tokens")).toBeTruthy();
  expect(screen.getByText("7")).toBeTruthy();
  expect(actions).toEqual([{ kind: "source", id: "archived-job" }]);
});
const settings = {
  baseUrl: "https://images.example.com/v1",
  model: "image-fixture",
  requiresKey: false,
  size: "auto",
  quality: "auto",
};
const plan: OutfitPlan = {
  libraryId: "library",
  digest: "plan-digest",
  settings,
  input: { person: 1, clothing: null, description: "Blue jacket" },
  references: [{ assetId: 1, name: "person.png", sha256: "source-hash" }],
  prompt: "Frozen blue jacket prompt",
};
function host(state: "unknown" | "ready" = "unknown", lostReceipt = false) {
  const actions: Record<string, unknown>[] = [];
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as Record<string, unknown>;
    if (request.kind === "list")
      return {
        libraryId: "library",
        page: { assets: [{ id: 1, name: "person.png" }], next: null },
      };
    if (request.kind === "preview") return { handle: "preview" };
    if (request.kind === "readPreview") return { mimeType: "image/png", base64: "aW1hZ2U=" };
    const action = request.action as Record<string, unknown>;
    actions.push(action);
    if (action.kind === "settings")
      return { libraryId: "library", settings, credentialConfigured: false };
    if (action.kind === "saveSettings")
      return { settings: action.settings, credentialConfigured: !!action.apiKey };
    if (action.kind === "prepare") return { plan: { ...plan, input: action.input } };
    if (action.kind === "submit") {
      if (lostReceipt) throw "connection lost";
      return {};
    }
    if (action.kind === "status")
      return { job: { id: action.id, state, plan, created: 1 }, active: false, archived: null };
    if (action.kind === "preview")
      return { mimeType: "image/png", base64: "aW1hZ2U=", sha256: "output-hash" };
    if (action.kind === "approve") return { assetId: 2 };
    if (action.kind === "history")
      return { entries: [{ id: "saved-job", state, plan, created: 1 }], next: null };
    throw new Error(`Unexpected ${JSON.stringify(request)}`);
  });
  return { invoke, actions };
}
async function review() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Choose from library · Person image" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "person.png" }));
  fireEvent.change(screen.getByLabelText("Describe the new outfit"), {
    target: { value: "Blue jacket" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review outfit generation" }));
  await screen.findByRole("region", { name: "Confirm outfit generation" });
}

it("requires explicit upload confirmation and discards a reviewed plan when the brief changes", async () => {
  const { invoke, actions } = host();
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" sceneId="scene" />);
  await review();
  expect(actions.some((action) => action.kind === "submit")).toBe(false);
  expect(screen.getByText("Frozen blue jacket prompt")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Describe the new outfit"), {
    target: { value: "Red coat" },
  });
  expect(screen.queryByRole("region", { name: "Confirm outfit generation" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Review outfit generation" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm upload and generate outfit" }),
  );
  await screen.findByText(
    "The generation outcome is unknown. It will not be sent again automatically.",
  );
  const submitted = actions.filter((action) => action.kind === "submit");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]).toMatchObject({
    confirmed: true,
    digest: "plan-digest",
    input: { description: "Red coat" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh generation status" }));
  await waitFor(() => expect(actions.filter((action) => action.kind === "status")).toHaveLength(2));
  expect(actions.filter((action) => action.kind === "submit")).toHaveLength(1);
});

it("queries the original request after a lost receipt and never retries a submission", async () => {
  const { invoke, actions } = host("unknown", true);
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" />);
  await review();
  fireEvent.click(screen.getByRole("button", { name: "Confirm upload and generate outfit" }));
  await screen.findByText(
    "The generation outcome is unknown. It will not be sent again automatically.",
  );
  const sent = actions.find((action) => action.kind === "submit");
  expect(actions.find((action) => action.kind === "status")?.id).toBe(sent?.id);
  expect(actions.filter((action) => action.kind === "submit")).toHaveLength(1);
});

it.each([
  "cancel",
  "fail",
])("withdraws the old plan while replacing an image, including %s", async (outcome) => {
  const { invoke: base, actions } = host();
  let finish!: (value: unknown) => void;
  let fail!: (reason: unknown) => void;
  const pending = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const invoke = vi.fn<Invoke>((command, args) =>
    (args.request as Record<string, unknown>).kind === "import" ? pending : base(command, args),
  );
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" />);
  await review();
  fireEvent.click(screen.getByRole("button", { name: "Choose new image · Person image" }));
  expect(screen.queryByRole("region", { name: "Confirm outfit generation" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Review outfit generation" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  if (outcome === "cancel") finish({ cancelled: true });
  else fail(new Error("selection failed"));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Review outfit generation" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(screen.getByText("person.png")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Confirm outfit generation" })).toBeNull();
  expect(actions.some((action) => action.kind === "submit")).toBe(false);
});

it("loads a saved result for comparison and saves only after separate approval", async () => {
  const { invoke, actions } = host("ready");
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" />);
  fireEvent.click(await screen.findByRole("button", { name: "Load saved image tasks" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Character outfit change · Blue jacket · image-fixture",
    }),
  );
  await screen.findByRole("button", { name: "Approve and save outfit result" });
  expect(await screen.findByAltText("Original person")).toBeTruthy();
  expect(screen.getByAltText("Generated outfit")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Approve and save outfit result" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.load(screen.getByAltText("Generated outfit"));
  expect(actions.some((action) => action.kind === "approve" || action.kind === "submit")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Approve and save outfit result" }));
  await screen.findByText("Outfit result saved to the library. Your original image is unchanged.");
  expect(actions.filter((action) => action.kind === "approve")).toEqual([
    { kind: "approve", id: "saved-job", sha256: "output-hash" },
  ]);
});

it("discards a late image selection after switching workspaces", async () => {
  const { invoke: base } = host();
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const invoke = vi.fn<Invoke>((command, args) =>
    (args.request as Record<string, unknown>).kind === "import" ? pending : base(command, args),
  );
  const view = render(<OutfitWorkspace invoke={invoke} workspaceId="old-workspace" />);
  fireEvent.click(await screen.findByRole("button", { name: "Choose new image · Person image" }));
  view.rerender(<OutfitWorkspace invoke={invoke} workspaceId="new-workspace" />);
  await screen.findByRole("button", { name: "Choose new image · Person image" });
  await Promise.resolve().then(() => finish({ assetId: 9 }));
  await waitFor(() =>
    expect(
      invoke.mock.calls.filter(
        ([, args]) =>
          ((args.request as Record<string, unknown>).action as Record<string, unknown> | undefined)
            ?.kind === "settings",
      ),
    ).toHaveLength(2),
  );
  expect(
    invoke.mock.calls.some(([, args]) => (args.request as Record<string, unknown>).kind === "list"),
  ).toBe(false);
  expect(screen.queryByText("Selected image")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Review outfit generation" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("does not offer approval when the result preview fails to render", async () => {
  const { invoke, actions } = host("ready");
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" />);
  fireEvent.click(await screen.findByRole("button", { name: "Load saved image tasks" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Character outfit change · Blue jacket · image-fixture",
    }),
  );
  fireEvent.error(await screen.findByAltText("Generated outfit"));
  expect(screen.queryByRole("button", { name: "Approve and save outfit result" })).toBeNull();
  expect(actions.some((action) => action.kind === "approve")).toBe(false);
});

it("invalidates confirmation on settings edits and updates the credential indicator after saving", async () => {
  const { invoke, actions } = host();
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" />);
  await review();
  fireEvent.click(screen.getByText("Image model settings"));
  fireEvent.click(screen.getByLabelText("Endpoint requires an API key"));
  fireEvent.change(screen.getByLabelText("API key (stored on this computer)"), {
    target: { value: "fixture-key" },
  });
  expect(screen.queryByRole("region", { name: "Confirm outfit generation" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Review outfit generation" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save image model settings" }));
  await screen.findByText("Image model settings saved.");
  expect(screen.getByText("A key is configured for this endpoint.")).toBeTruthy();
  expect(
    (screen.getByLabelText("API key (stored on this computer)") as HTMLInputElement).value,
  ).toBe("");
  expect(actions.some((action) => action.kind === "submit")).toBe(false);
});

it("does not carry selected inputs or pending plans into another workspace", async () => {
  const { invoke, actions } = host();
  const view = render(<OutfitWorkspace invoke={invoke} workspaceId="first" />);
  await review();
  view.rerender(<OutfitWorkspace invoke={invoke} workspaceId="second" />);
  await screen.findByRole("button", { name: "Review outfit generation" });
  expect(screen.queryByRole("region", { name: "Confirm outfit generation" })).toBeNull();
  expect((screen.getByLabelText("Describe the new outfit") as HTMLTextAreaElement).value).toBe("");
  expect(actions.some((action) => action.kind === "submit")).toBe(false);
});
