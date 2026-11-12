import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("resets the cursor for exact duplicates, combines filters and protects restore", async () => {
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as {
      kind: string;
      after?: number;
      duplicatesOnly?: boolean;
    };
    if (request.kind === "backupStatus") return { job: null };
    if (request.kind === "list")
      return {
        libraryId: "library",
        collections: [{ id: "group", name: "合集" }],
        page: {
          assets: request.duplicatesOnly
            ? []
            : [{ id: request.after ? 2 : 1, name: "月光.png", digest: "a" }],
          next: request.duplicatesOnly || request.after ? null : 1,
        },
      };
    throw new Error("missing preview");
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  await screen.findByText("月光.png");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search image filenames" }), {
    target: { value: "月" },
  });
  fireEvent.change(screen.getByRole("searchbox", { name: "Filter by tag" }), {
    target: { value: "主角" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
  fireEvent.change(screen.getByRole("combobox", { name: "Filter by collection" }), {
    target: { value: "group" },
  });
  await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
      workspaceId: "workspace",
      request: { kind: "list", after: 1, query: "月", tag: "主角", collectionId: "group" },
    }),
  );
  await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
  fireEvent.click(screen.getByRole("checkbox", { name: "Exact duplicates" }));
  await screen.findByText("No assets match these filters.");
  expect(invoke).toHaveBeenCalledWith("visual_assets_control", {
    workspaceId: "workspace",
    request: {
      kind: "list",
      after: 0,
      query: "月",
      tag: "主角",
      collectionId: "group",
      duplicatesOnly: true,
    },
  });
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Restore library" }).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Exact duplicates" }));
  await screen.findByText("月光.png");
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Exact duplicates" }).checked).toBe(
    false,
  );
  const lists = invoke.mock.calls.filter(
    ([, args]) => (args.request as { kind: string }).kind === "list",
  );
  expect(lists.at(-1)?.[1].request).toEqual({
    kind: "list",
    after: 0,
    query: "月",
    tag: "主角",
    collectionId: "group",
  });
});

it("enables restore only while the empty library has no duplicate filter", async () => {
  const invoke = vi.fn<Invoke>(async (_command, args) => {
    const request = args.request as { kind: string };
    if (request.kind === "backupStatus") return { job: null };
    return { libraryId: "library", page: { assets: [], next: null } };
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  await screen.findByText("Import an image to start your visual library.");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Restore library" }).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Exact duplicates" }));
  await screen.findByText("No assets match these filters.");
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Restore library" }).disabled).toBe(
    true,
  );
});
