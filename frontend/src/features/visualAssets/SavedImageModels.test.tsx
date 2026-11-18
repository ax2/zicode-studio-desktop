import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setLocale } from "../../shared/i18n";
import { ImageModelSettings } from "./ImageModelSettings";
import { SavedImageModels } from "./SavedImageModels";
import type { ImageSettings } from "./outfit-types";

const original: ImageSettings = { baseUrl: "https://images.example.org/v1", model: "image-existing", requiresKey: true, size: "auto", quality: "auto" };
const second: ImageSettings = { ...original, baseUrl: "http://127.0.0.1:8188/v1", model: "local-manual", requiresKey: false };
afterEach(() => { cleanup(); setLocale("zh-CN"); vi.restoreAllMocks(); });

it("loads and selects named image models without generation or changing manual local model support", async () => {
  setLocale("en");
  const profiles = [{ id: "one", name: "Existing", settings: original }, { id: "two", name: "Local", settings: second }];
  let selected = "one";
  const request = vi.fn(async (action: Record<string, unknown>) => {
    if (action.kind === "modelProfiles") return { profiles, selectedProfileId: selected };
    if (action.kind === "selectModelProfile") { selected = String(action.id); return { settings: second, credentialConfigured: false, selectedProfileId: selected }; }
    throw new Error("unexpected request");
  });
  const onSaved = vi.fn(), onEdit = vi.fn(), onBusyChange = vi.fn();
  render(<SavedImageModels settings={original} apiKey="" request={request} disabled={false} onSaved={onSaved} onEdit={onEdit} onBusyChange={onBusyChange} />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load saved models" }));
  await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("one"));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "two" } });
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ settings: second, credentialConfigured: false })));
  expect(request.mock.calls.map(([action]) => action.kind)).toEqual(["modelProfiles", "selectModelProfile", "modelProfiles"]);
  expect(onEdit).toHaveBeenCalledOnce();
  expect(profiles[0].settings).toEqual(original);
});

it("saves a named model explicitly and removal preserves active settings", async () => {
  setLocale("en");
  let profiles: Array<{ id: string; name: string; settings: ImageSettings }> = [];
  let selected = "";
  const request = vi.fn(async (action: Record<string, unknown>) => {
    if (action.kind === "modelProfiles") return { profiles, selectedProfileId: selected };
    if (action.kind === "saveModelProfile") {
      selected = "new"; profiles = [{ id: selected, name: String(action.name), settings: original }];
      return { settings: original, credentialConfigured: true, selectedProfileId: selected };
    }
    if (action.kind === "removeModelProfile") { profiles = []; selected = ""; return { settings: original, credentialConfigured: true, selectedProfileId: null }; }
    throw new Error("unexpected request");
  });
  const onSaved = vi.fn();
  render(<SavedImageModels settings={original} apiKey="" request={request} disabled={false} onSaved={onSaved} onEdit={() => {}} onBusyChange={() => {}} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Saved model name" }), { target: { value: "My image model" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and use this model" }));
  await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("new"));
  expect(request).toHaveBeenCalledWith({ kind: "saveModelProfile", name: "My image model", settings: original, apiKey: null });
  vi.spyOn(globalThis, "confirm").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove saved model" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith({ kind: "removeModelProfile", id: "new", confirmed: true }));
  await waitFor(() => expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(""));
  expect(onSaved).toHaveBeenLastCalledWith(expect.objectContaining({ settings: original, credentialConfigured: true }));
});

it("applies the selected profile to the editable form and clears a pending typed key", async () => {
  setLocale("en");
  const request = vi.fn(async (action: Record<string, unknown>) => {
    if (action.kind === "modelProfiles") return { profiles: [{ id: "local", name: "Local", settings: second }], selectedProfileId: "local" };
    if (action.kind === "selectModelProfile") return { settings: second, credentialConfigured: false, selectedProfileId: "local" };
    throw new Error("unexpected request");
  });
  render(<ImageModelSettings settings={original} configured request={request} disabled={false} onSaved={() => {}} onBusyChange={() => {}} onEdit={() => {}} />);
  fireEvent.click(screen.getByText("Image model settings"));
  fireEvent.change(screen.getByLabelText("API key (stored on this computer)"), { target: { value: "fixture-unsaved-image-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Load saved models" }));
  await waitFor(() => expect((screen.getByLabelText("Active image model") as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Active image model"), { target: { value: "local" } });
  await waitFor(() => expect((screen.getByLabelText("Image model ID") as HTMLInputElement).value).toBe("local-manual"));
  expect((screen.getByLabelText("Image API base URL") as HTMLInputElement).value).toBe(second.baseUrl);
  expect((screen.getByLabelText("Endpoint requires an API key") as HTMLInputElement).checked).toBe(false);
  expect(request.mock.calls.some(([action]) => action.apiKey === "fixture-unsaved-image-key")).toBe(false);
});
