import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("imports references and reconnects a missing grant without sending a path", async () => {
  let imported = false;
  let connected = false;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string };
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "list")
      return {
        libraryId: "library",
        page: {
          assets: imported ? [{ id: 1, name: "原件.png", digest: "a", referenced: true }] : [],
          next: null,
        },
      };
    if (request.kind === "importReferences") {
      imported = true;
      return { items: [{ name: "原件.png", position: 0, status: "imported" }] };
    }
    if (request.kind === "preview") return { handle: "preview" };
    if (request.kind === "reauthorizeReference") {
      connected = true;
      return { updated: true };
    }
    if (connected) return { mimeType: "image/png", base64: "aW1hZ2U=" };
    throw new Error("reference_not_authorized");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  await screen.findByText("Import an image to start your visual library.");
  fireEvent.click(screen.getByRole("button", { name: "Reference images" }));
  await screen.findByText("Source needs authorization.");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "importReferences" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Reconnect source for 原件.png" }));
  const preview = await screen.findByRole("img", { name: "原件.png" });
  expect(preview.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "reauthorizeReference", libraryId: "library", assetId: 1, revision: 1 },
  });
});
