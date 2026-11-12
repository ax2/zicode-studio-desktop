import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("saves comma-separated tags and filters by a saved tag together with the filename", async () => {
  let tags: string[] = [];
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string; tags?: string[] };
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "setTags") {
      tags = request.tags ?? [];
      return { tags };
    }
    if (request.kind === "list")
      return {
        libraryId: "library",
        page: { assets: [{ id: 1, name: "月光.png", digest: "a", tags }], next: null },
      };
    throw new Error("missing preview");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit tags for 月光.png" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Tags separated by commas" }), {
    target: { value: " 主角，夜景 " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save tags" }));
  await screen.findByRole("button", { name: "主角" });
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: {
      kind: "setTags",
      libraryId: "library",
      assetId: 1,
      previous: [],
      tags: ["主角", "夜景"],
    },
  });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search image filenames" }), {
    target: { value: "月" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: "主角" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
      workspaceId: "workspace",
      request: { kind: "list", after: 0, query: "月", tag: "主角" },
    }),
  );
});

it("resets the cursor for a filename search and keeps restore disabled on an empty result", async () => {
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string; after?: number; query?: string };
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "list")
      return {
        libraryId: "library",
        page: {
          assets: request.query
            ? []
            : [
                {
                  id: request.after ? 2 : 1,
                  name: request.after ? "second.png" : "first.png",
                  digest: "a",
                },
              ],
          next: request.query || request.after ? null : 1,
        },
      };
    throw new Error("missing preview");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  await screen.findByText("first.png");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("second.png");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search image filenames" }), {
    target: { value: "月光" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("No filenames match this search.");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "list", after: 0, query: "月光" },
  });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Restore library" }).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  await screen.findByText("first.png");
});

it("reloads committed assets after a partial import and shows failures and exact matches", async () => {
  let imported = false;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string };
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "importBatch") {
      imported = true;
      return {
        items: [
          { name: "valid.png", position: 0, status: "imported" },
          { name: "bad.png", position: 1, status: "failed" },
          {
            name: "copy.png",
            position: 2,
            status: "imported",
            duplicateOf: { id: 1, name: "valid.png" },
          },
        ],
      };
    }
    if (request.kind === "list")
      return {
        libraryId: "library",
        page: { assets: imported ? [{ id: 1, name: "valid.png", digest: "a" }] : [], next: null },
      };
    throw new Error("missing preview");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  await screen.findByText("Import an image to start your visual library.");
  fireEvent.click(screen.getByRole("button", { name: "Import images" }));
  await screen.findByText("valid.png");
  expect(screen.getByText("Imported 2 of 3 images.")).toBeTruthy();
  expect(screen.getByText(/bad.png · Could not import/)).toBeTruthy();
  expect(screen.getByText("copy.png · Same original as valid.png (asset #1).")).toBeTruthy();
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: { kind: "importBatch" },
  });
});

it("paginates and keeps saved assets visible when previews fail", async () => {
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string; after?: number };
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "list")
      return {
        libraryId: "library",
        page: {
          assets: [
            {
              id: request.after ? 2 : 1,
              name: request.after ? "second.png" : "first.png",
              digest: "a",
            },
          ],
          next: request.after ? null : 1,
        },
      };
    throw new Error("missing thumbnail");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  await screen.findByText("first.png");
  await screen.findByText("Preview unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("second.png");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("first.png");
});

it("stops issuing previews after the view is unmounted", async () => {
  let finish: (value: unknown) => void = () => {};
  const invoke = vi.fn<Invoke>((_command, args) => {
    if ((args.request as { kind: string }).kind === "backupStatus")
      return Promise.resolve({ job: null });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const view = render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  view.unmount();
  finish({
    libraryId: "library",
    page: { assets: [{ id: 1, name: "old.png", digest: "a" }], next: null },
  });
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(
    invoke.mock.calls.some(([, args]) => (args.request as { kind: string }).kind === "preview"),
  ).toBe(false);
});
