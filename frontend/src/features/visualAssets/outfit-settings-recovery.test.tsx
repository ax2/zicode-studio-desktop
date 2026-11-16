import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OutfitWorkspace } from "./OutfitWorkspace";
import type { Invoke } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const config = {
  libraryId: "library",
  settings: {
    baseUrl: "https://images.example.com/v1",
    model: "recovered-model",
    requiresKey: false,
    size: "auto",
    quality: "auto",
  },
  credentialConfigured: false,
};
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
it("recovers settings after save-time library contention without any creation action", async () => {
  vi.useFakeTimers();
  let busy = true;
  const invoke = vi.fn<Invoke>(async () => {
    if (busy) throw "visual_assets_busy";
    return config;
  });
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" />);
  await advance(200);
  busy = false;
  await advance(2000);
  expect(screen.getByDisplayValue("recovered-model")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  for (const [, args] of invoke.mock.calls) {
    expect(args.request).toEqual(
      expect.objectContaining({ kind: "creation", action: { kind: "settings" } }),
    );
  }
});
it("bounds retries then permits explicit recovery without resubmitting a job", async () => {
  vi.useFakeTimers();
  let busy = true;
  const invoke = vi.fn<Invoke>(async () => {
    if (busy) throw "visual_assets_busy";
    return config;
  });
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" />);
  await advance(10000);
  expect(invoke).toHaveBeenCalledTimes(8);
  expect(screen.getByRole("alert").textContent).toContain("Another image task");
  await advance(10000);
  expect(invoke).toHaveBeenCalledTimes(8);
  busy = false;
  fireEvent.click(screen.getByRole("button", { name: "Reload image settings" }));
  await advance(0);
  expect(screen.getByDisplayValue("recovered-model")).toBeTruthy();
  expect(invoke).toHaveBeenCalledTimes(9);
});
it("does not retry non-contention errors", async () => {
  vi.useFakeTimers();
  const invoke = vi.fn<Invoke>().mockRejectedValue("visual_assets_creation_credential_required");
  render(<OutfitWorkspace invoke={invoke} workspaceId="workspace" />);
  await advance(10000);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toContain("Configure an API key");
});
it("cancels scheduled reads when the workspace changes", async () => {
  vi.useFakeTimers();
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    if (args.workspaceId === "old") throw "visual_assets_busy";
    return config;
  });
  const view = render(<OutfitWorkspace invoke={invoke} workspaceId="old" />);
  await advance(150);
  view.rerender(<OutfitWorkspace invoke={invoke} workspaceId="new" />);
  await advance(10000);
  expect(invoke.mock.calls.filter(([, args]) => args.workspaceId === "old")).toHaveLength(2);
  expect(screen.getByDisplayValue("recovered-model")).toBeTruthy();
});
