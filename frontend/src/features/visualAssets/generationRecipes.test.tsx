import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RecipeDraft } from "./GenerationRecipeForm";
import { GenerationRecipes } from "./GenerationRecipes";
import type { CharacterRequest } from "./useCharacterRecords";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);

it("pins chosen inputs and keeps the settings text intact when reviewing an older version", async () => {
  const versions: { version: number; draft: RecipeDraft }[] = [];
  const settings = '{ "seed": 9223372036854775807 }';
  const request = vi.fn<CharacterRequest>(async (action) => {
    switch (action.kind) {
      case "recipes":
        return { entries: versions.length ? [{ id: "recipe", name: "夜景" }] : [], next: null };
      case "revisions":
        return {
          entries:
            action.facet === "identity"
              ? [
                  { version: 2, text: "新身份" },
                  { version: 1, text: "旧身份" },
                ]
              : [],
          next: null,
        };
      case "referenceSets":
        return { entries: [{ id: 9, name: "已批准的旧参考" }], next: null };
      case "createRecipe":
        versions.unshift({ version: 1, draft: action.draft as RecipeDraft });
        return { id: "recipe", version: 1 };
      case "recipeVersions":
        return { entries: [...versions], next: null };
      case "appendRecipe":
        versions.unshift({ version: 2, draft: action.draft as RecipeDraft });
        return { version: 2 };
      case "recipeInputs":
        return {
          recipe: versions.find((entry) => entry.version === action.version),
          identity: "旧身份",
          appearance: null,
          style: null,
          referenceSet: {
            name: "已批准的旧参考",
            references: [{ assetId: 3, name: "灯.png", revision: 1, sha256: "a".repeat(64) }],
          },
        };
      default:
        throw new Error("Unexpected recipe request");
    }
  });
  render(<GenerationRecipes id="character" disabled={false} request={request} />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Generation recipes" }));
  const identity = screen.getByRole<HTMLSelectElement>("combobox", { name: "Identity version" });
  await waitFor(() => expect(identity.value).toBe("2"));
  fireEvent.change(identity, { target: { value: "1" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Approved reference set" }), {
    target: { value: "9" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Recipe name" }), {
    target: { value: "夜景" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Generation prompt" }), {
    target: { value: "旧提示词" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Generation settings (JSON)" }), {
    target: { value: settings },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create generation recipe" }));
  await screen.findByRole("button", { name: "Review recipe version 1" });
  expect(request).toHaveBeenCalledWith({
    kind: "createRecipe",
    id: "character",
    name: "夜景",
    draft: {
      identityVersion: 1,
      appearanceVersion: null,
      styleVersion: null,
      referenceSetId: 9,
      prompt: "旧提示词",
      negativePrompt: "",
      settingsJson: settings,
    },
  });

  fireEvent.change(screen.getByRole("textbox", { name: "Generation prompt" }), {
    target: { value: "新提示词" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save recipe version" }));
  await screen.findByRole("button", { name: "Review recipe version 2" });
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "appendRecipe",
      recipeId: "recipe",
      previous: 1,
      draft: expect.objectContaining({ settingsJson: settings }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review recipe version 1" }));
  const review = within(await screen.findByRole("region", { name: "Saved recipe inputs" }));
  expect(review.getByText("旧提示词")).toBeTruthy();
  expect(review.getByText("旧身份")).toBeTruthy();
  expect(review.getByText(settings)).toBeTruthy();
  expect(review.getByText(/灯\.png/)).toBeTruthy();
});
