import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnimationInstall } from "./AnimationInstall";
import { BackupPanel } from "./BackupPanel";
import type { Invoke } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

const reviewed = {
  token: "review-1",
  plan: {
    destination: "D:\\godot\\zicode-animation-walk",
    resourcePath: "res://zicode-animation-walk/clip.tscn",
    previous: "previous-digest",
  },
};

it("shows the selected project and stable path before confirming a separate request", async () => {
  let job: { id: string; operation: "animation"; state: string; destination: string } | null = null;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string };
    if (request.kind === "planAnimationInstall") return reviewed;
    if (request.kind === "confirmAnimationInstall") {
      job = {
        id: "install-1",
        operation: "animation",
        state: "completed",
        destination: reviewed.plan.destination,
      };
    }
    return { job };
  });
  render(
    <BackupPanel
      invoke={invoke}
      workspaceId="workspace"
      animation={{ libraryId: "library", assets: [{ id: 1, name: "Walk.png" }] }}
      disabled={false}
      onBusyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Animation" }));
  const image = screen.getByRole<HTMLSelectElement>("combobox", { name: "Frame image" });
  await waitFor(() => expect(image.disabled).toBe(false));
  fireEvent.change(image, { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
  const name = screen.getByRole("textbox", { name: "Animation name" });
  const planButton = screen.getByRole<HTMLButtonElement>("button", {
    name: "Choose Godot project and review",
  });
  fireEvent.change(name, { target: { value: "../walk" } });
  expect(planButton.disabled).toBe(true);
  fireEvent.change(name, { target: { value: "walk" } });
  fireEvent.click(screen.getByRole("button", { name: "Choose Godot project and review" }));
  await screen.findByText(reviewed.plan.destination);
  expect(screen.getByText(`Scene reference ${reviewed.plan.resourcePath}`)).toBeDefined();
  expect(
    invoke.mock.calls.some(
      ([, args]) => (args.request as { kind: string }).kind === "confirmAnimationInstall",
    ),
  ).toBe(false);
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: {
      kind: "planAnimationInstall",
      name: "walk",
      intent: {
        libraryId: "library",
        source: { kind: "sequence" },
        recipe: {
          looped: true,
          frames: [{ assetId: 1, revision: 1, durationMs: 100, anchorX: 0, anchorY: 0 }],
        },
      },
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm animation update" }));
  await screen.findByText("Animation exported.");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "confirmAnimationInstall", token: reviewed.token },
  });
});

it("discards the reviewed grant when the animation name changes", async () => {
  const actions = {
    plan: vi.fn(async () => reviewed),
    confirm: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  };
  render(
    <AnimationInstall
      disabled={false}
      actions={actions}
      intent={{
        libraryId: "library",
        source: { kind: "sequence" },
        recipe: { looped: true, frames: [] },
      }}
    />,
  );
  const name = screen.getByRole("textbox", { name: "Animation name" });
  fireEvent.change(name, { target: { value: "walk" } });
  fireEvent.click(screen.getByRole("button", { name: "Choose Godot project and review" }));
  await screen.findByRole("button", { name: "Confirm animation update" });
  fireEvent.change(name, { target: { value: "walk-2" } });
  expect(screen.queryByRole("button", { name: "Confirm animation update" })).toBeNull();
  expect(actions.cancel).toHaveBeenCalledWith(reviewed.token);
  expect(actions.confirm).not.toHaveBeenCalled();
});
