import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Collection, CollectionEdit } from "./Collections";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("adds images to a collection and requires confirmation before removing the collection", async () => {
  let collections: Collection[] = [];
  let member = false;
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string; collectionId?: string; edit?: CollectionEdit };
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "changeCollections") {
      const edit = request.edit;
      if (edit?.kind === "create") collections = [{ id: "group", name: edit.name }];
      if (edit?.kind === "membership") member = edit.member;
      if (edit?.kind === "delete") {
        collections = [];
        member = false;
      }
      return {};
    }
    if (request.kind === "list")
      return {
        libraryId: "library",
        collections,
        page: {
          assets:
            request.collectionId && !member
              ? []
              : [{ id: 1, name: "月光.png", digest: "a", collectionIds: member ? ["group"] : [] }],
          next: null,
        },
      };
    throw new Error("missing preview");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  await screen.findByText("月光.png");
  fireEvent.click(screen.getByRole("button", { name: "New collection" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Collection name" }), {
    target: { value: "夜景" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save collection" }));
  fireEvent.change(
    await screen.findByRole("combobox", { name: "Choose a collection for 月光.png" }),
    {
      target: { value: "group" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Add to collection" }));
  await screen.findByRole("button", { name: "Remove from collection" });
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: {
      kind: "changeCollections",
      libraryId: "library",
      edit: { kind: "membership", id: "group", assetId: 1, member: true },
    },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Filter by collection" }), {
    target: { value: "group" },
  });
  fireEvent.click(await screen.findByRole("button", { name: "Delete collection" }));
  expect(collections).toHaveLength(1);
  expect(screen.getByText("Delete 夜景 and its memberships?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm collection deletion" }));
  await screen.findByText("月光.png");
  expect(collections).toHaveLength(0);
  expect(
    (screen.getByRole("combobox", { name: "Filter by collection" }) as HTMLSelectElement).value,
  ).toBe("");
});
