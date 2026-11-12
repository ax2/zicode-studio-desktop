import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type Invoke, VisualAssetsApp } from "./VisualAssetsApp";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("saves independent character revisions and approves the reviewed asset revisions", async () => {
  const actions: Record<string, unknown>[] = [];
  let created = false;
  let appearance = false;
  let approved = false;
  let referenceLookupBusy = true;
  const assets = [
    { id: 1, name: "One.png" },
    { id: 2, name: "Two.png" },
  ];
  const invoke = vi.fn<Invoke>(async (_command, { request: input }) => {
    const request = input as { kind: string; libraryId?: string; action?: Record<string, unknown> };
    if (request.kind === "list")
      return {
        libraryId: "library",
        charactersAvailable: true,
        hasCharacters: created,
        page: { assets, next: null },
      };
    if (request.kind === "preview") return { handle: "preview" };
    if (request.kind === "readPreview") return { mimeType: "image/png", base64: "AA==" };
    if (request.kind !== "characters" || !request.action) return { job: null };
    expect(request.libraryId).toBe("library");
    const action = request.action;
    actions.push(action);
    switch (action.kind) {
      case "list":
        return { entries: created ? [{ id: "role", name: "绘光" }] : [], next: null };
      case "create":
        created = true;
        return { id: "role" };
      case "revisions":
        return {
          entries:
            action.facet === "identity"
              ? [{ version: 1, text: "绘制光源的旅人" }]
              : appearance
                ? [{ version: 1, text: "红色旅袍" }]
                : [],
          next: null,
        };
      case "append":
        appearance = true;
        return { version: 1 };
      case "referenceSets":
        if (referenceLookupBusy) {
          referenceLookupBusy = false;
          throw new Error("visual_assets_busy");
        }
        return {
          entries: approved
            ? [
                {
                  id: 1,
                  name: "已审",
                  references: [
                    { assetId: 2, revision: 1, name: "Two.png", sha256: "f".repeat(64) },
                    { assetId: 1, revision: 1, name: "One.png", sha256: "a".repeat(64) },
                  ],
                },
              ]
            : [],
          next: null,
        };
      case "approveReferences":
        approved = true;
        return { id: 1 };
      default:
        throw new Error("Unexpected character request");
    }
  });
  render(<VisualAssetsApp invoke={invoke} workspaceId="workspace" />);
  const panel = await screen.findByRole("button", { name: "Characters" });
  expect(actions).toHaveLength(0);
  fireEvent.click(panel);
  fireEvent.click(screen.getByText("New character"));
  fireEvent.change(screen.getByRole("textbox", { name: "Character name" }), {
    target: { value: "绘光" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Initial identity" }), {
    target: { value: "绘制光源的旅人" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create character" }));
  await waitFor(() =>
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Identity" }).value).toBe(
      "绘制光源的旅人",
    ),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Character versions" }), {
    target: { value: "appearance" },
  });
  const version = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Appearance" });
  await waitFor(() => expect(version.disabled).toBe(false));
  fireEvent.change(version, { target: { value: "红色旅袍" } });
  fireEvent.click(screen.getByRole("button", { name: "Save new version" }));
  await screen.findByText("Version 1");
  expect(actions).toContainEqual({
    kind: "append",
    id: "role",
    facet: "appearance",
    previous: null,
    text: "红色旅袍",
  });

  fireEvent.change(screen.getByRole("textbox", { name: "Reference set name" }), {
    target: { value: "已审" },
  });
  const picker = screen.getByRole("combobox", { name: "Reference image" });
  for (const id of ["2", "1"]) {
    fireEvent.change(picker, { target: { value: id } });
    fireEvent.click(screen.getByRole("button", { name: "Add reference image" }));
  }
  expect(actions.some((action) => action.kind === "approveReferences")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Approve reference set" }));
  await screen.findByText("已审 (2)");
  expect(actions).toContainEqual({
    kind: "approveReferences",
    id: "role",
    requestId: expect.any(String),
    name: "已审",
    references: [
      { assetId: 2, revision: 1 },
      { assetId: 1, revision: 1 },
    ],
  });
});
