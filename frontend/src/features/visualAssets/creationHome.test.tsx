import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { creationWorkflows } from "./creation-workflows";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("opens on ordered creative tasks without scanning or importing a library", async () => {
  const invoke = vi.fn<Invoke>(async () => ({
    libraryId: "library",
    settings: {
      baseUrl: "https://api.example.com/v1",
      model: "",
      requiresKey: true,
      size: "auto",
      quality: "auto",
    },
    credentialConfigured: false,
  }));
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" sceneId="creative" />);
  expect(
    screen.getAllByRole("button", { name: /^Open workflow/ }).map((button) => button.textContent),
  ).toEqual(creationWorkflows.map((workflow) => `Open workflow · ${workflow.title}`));
  expect(screen.queryByRole("button", { name: "Import images" })).toBeNull();
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open workflow · Character outfit change" }));
  expect(screen.getByRole("region", { name: "Character outfit change" })).toBeTruthy();
  await screen.findByText("Image model settings");
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith(
    "visual_assets_control",
    expect.objectContaining({
      request: expect.objectContaining({ kind: "creation", action: { kind: "settings" } }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Creation home" }));
  expect(screen.getByRole("heading", { name: "What would you like to create?" })).toBeTruthy();
});

it("opens the existing functional library as supporting material management", async () => {
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string };
    if (request.kind === "list") return { libraryId: "library", page: { assets: [], next: null } };
    if (request.kind === "backupStatus") return { job: null };
    throw new Error("Unexpected operation");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  fireEvent.click(screen.getByRole("button", { name: "Materials and library" }));
  await screen.findByText("Import an image to start your visual library.");
  expect(screen.getByRole("button", { name: "Import images" })).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith(
    "visual_assets_control",
    expect.objectContaining({
      workspaceId: "workspace",
      request: expect.objectContaining({ kind: "list" }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Creation home" }));
  expect(screen.queryByRole("button", { name: "Import images" })).toBeNull();
  expect(
    invoke.mock.calls.every(([, args]) =>
      ["list", "backupStatus"].includes((args.request as { kind: string }).kind),
    ),
  ).toBe(true);
});
