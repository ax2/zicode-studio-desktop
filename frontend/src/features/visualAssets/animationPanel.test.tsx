import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupPanel } from "./BackupPanel";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

const animation = {
  libraryId: "library",
  assets: [
    { id: 1, name: "First.png" },
    { id: 2, name: "Second.png" },
  ],
};

async function openPanel(invoke: Invoke, inLibrary = false) {
  render(
    inLibrary ? (
      <VisualAssetsApp invoke={invoke} workspaceId="workspace" />
    ) : (
      <BackupPanel
        animation={animation}
        invoke={invoke}
        workspaceId="workspace"
        disabled={false}
        onBusyChange={vi.fn()}
      />
    ),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Animation" }));
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", { name: "Animation source" }).disabled,
    ).toBe(false),
  );
}

describe("animation tasks", () => {
  it("shows a durable export even while the library listing is unavailable", async () => {
    const invoke = vi.fn<Invoke>(async () => ({
      job: { id: "resumed", operation: "animation", state: "running", destination: "D:\\exports" },
    }));
    render(<BackupPanel invoke={invoke} workspaceId="workspace" disabled onBusyChange={vi.fn()} />);
    await screen.findByText("Exporting animation...");
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Cancel animation export" }).disabled,
    ).toBe(false);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("sends ordered revisions and numeric frame settings, and cancels by job ID", async () => {
    let job: { id: string; operation: "animation"; state: string; destination: string } | null =
      null;
    const invoke = vi.fn<Invoke>(async (_command, args) => {
      const request = args.request as { kind: string };
      if (request.kind === "previewAnimation") {
        return {
          width: 5,
          height: 4,
          looped: true,
          frames: [{ durationMs: 245, base64: "iVBORw0KGgoA" }],
        };
      }
      if (request.kind === "startAnimation")
        job = {
          id: "export-1",
          operation: "animation",
          state: "running",
          destination: "D:\\exports",
        };
      if (request.kind === "cancelBackup" && job) job = { ...job, state: "cancelled" };
      return { job };
    });
    await openPanel(invoke);
    const picker = screen.getByRole("combobox", { name: "Frame image" });
    fireEvent.change(picker, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
    fireEvent.change(picker, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Move earlier" })[1]);
    fireEvent.change(screen.getAllByRole("spinbutton", { name: "Duration (ms)" })[0], {
      target: { value: "245" },
    });
    const intent = {
      libraryId: "library",
      source: { kind: "sequence" },
      recipe: {
        looped: true,
        frames: [
          { assetId: 2, revision: 1, durationMs: 245, anchorX: 0, anchorY: 0 },
          { assetId: 1, revision: 1, durationMs: 100, anchorX: 0, anchorY: 0 },
        ],
      },
    };
    fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
    await screen.findByRole("img", { name: "Animation preview frame" });
    expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
      workspaceId: "workspace",
      request: { kind: "previewAnimation", intent },
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose folder and export" }));
    await screen.findByText("Exporting animation...");
    expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
      workspaceId: "workspace",
      request: { kind: "startAnimation", intent },
    });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Back up library" }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel animation export" }));
    await screen.findByText("Animation export cancelled.");
    expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
      workspaceId: "workspace",
      request: { kind: "cancelBackup", jobId: "export-1" },
    });
  });

  it("keeps PNG export format and atlas settings when the folder picker is cancelled", async () => {
    const invoke = vi.fn<Invoke>(async (_command, args) => {
      const kind = (args.request as { kind: string }).kind;
      if (kind === "list")
        return { libraryId: animation.libraryId, page: { assets: animation.assets, next: null } };
      if (kind === "preview") return { handle: "sample-preview" };
      if (kind === "readPreview") return { mimeType: "image/png", base64: "AA==" };
      if (kind === "startAnimation") return { cancelled: true };
      return { job: null };
    });
    await openPanel(invoke, true);
    fireEvent.change(screen.getByRole("combobox", { name: "Animation source" }), {
      target: { value: "atlas" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Atlas image" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add frame" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Width (px)" }), {
      target: { value: "32" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Loop animation" }));
    const format = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Animation export format",
    });
    fireEvent.change(format, { target: { value: "pngSequence" } });
    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Choose folder and export",
    });
    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Width (px)" }).value).toBe(
      "32",
    );
    expect(format.value).toBe("pngSequence");
    expect(screen.queryByText("Animation exported.")).toBeNull();
    expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
      workspaceId: "workspace",
      request: {
        kind: "startAnimation",
        intent: {
          libraryId: "library",
          format: "pngSequence",
          source: { kind: "atlas", assetId: 1, revision: 1 },
          recipe: {
            looped: false,
            frames: [{ x: 0, y: 0, width: 32, height: 1, durationMs: 100, anchorX: 0, anchorY: 0 }],
          },
        },
      },
    });
  });
});
