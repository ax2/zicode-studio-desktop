import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("keeps a stale recipe draft pinned to the version it was edited from across two sessions", async () => {
  const initial: RecipeDraft = {
    identityVersion: 1, appearanceVersion: null, styleVersion: null, referenceSetId: 9,
    prompt: "Original prompt", negativePrompt: "", settingsJson: '{ "seed": 1 }',
  };
  const versions = [{ version: 1, draft: initial }];
  const request = vi.fn<CharacterRequest>(async (action) => {
    switch (action.kind) {
      case "recipes":
        return { entries: [{ id: "recipe", name: "Night scene" }], next: null };
      case "revisions":
        return { entries: action.facet === "identity" ? [{ version: 2, text: "New identity" }, { version: 1, text: "Earlier identity" }] : [], next: null };
      case "referenceSets":
        return { entries: [{ id: 10, name: "Current reference" }, { id: 9, name: "Previous reference" }], next: null };
      case "recipeVersions":
        return { entries: [...versions], next: null };
      case "appendRecipe": {
        if (action.previous !== versions[0].version) throw Error("visual_assets_recipe_version_changed");
        const version = versions[0].version + 1;
        versions.unshift({ version, draft: action.draft as RecipeDraft });
        return { version };
      }
      default:
        throw Error("Unexpected recipe request");
    }
  });
  render(<>
    <section aria-label="First editor"><GenerationRecipes id="character" disabled={false} request={request} /></section>
    <section aria-label="Second editor"><GenerationRecipes id="character" disabled={false} request={request} /></section>
  </>);
  const first = within(screen.getByRole("region", { name: "First editor" }));
  const second = within(screen.getByRole("region", { name: "Second editor" }));
  for (const editor of [first,second]) {
    fireEvent.click(editor.getByRole("button", { name: "Generation recipes" }));
    const recipe = editor.getByRole("combobox", { name: "Choose generation recipe" });
    await editor.findByRole("option", { name: "Night scene" });
    fireEvent.change(recipe, { target: { value: "recipe" } });
    await editor.findByRole("button", { name: "Review recipe version 1" });
  }
  const save = (editor: typeof first) => editor.getByRole<HTMLButtonElement>("button", { name: "Save recipe version" });
  const prompt = (editor: typeof first) => editor.getByRole<HTMLTextAreaElement>("textbox", { name: "Generation prompt" });
  const writes = () => request.mock.calls.map(([action]) => action).filter(({ kind }) => kind === "appendRecipe");

  fireEvent.change(prompt(first), { target: { value: "Unsaved editor A text" } });
  fireEvent.change(second.getByRole("combobox", { name: "Identity version" }), { target: { value: "2" } });
  fireEvent.change(second.getByRole("combobox", { name: "Approved reference set" }), { target: { value: "10" } });
  const newerSettings = '{ "seed": 9223372036854775807 }';
  fireEvent.change(second.getByRole("textbox", { name: "Generation settings (JSON)" }), { target: { value: newerSettings } });
  fireEvent.change(prompt(second), { target: { value: "Updated editor B prompt" } });
  fireEvent.click(save(second));
  await second.findByRole("button", { name: "Review recipe version 2" });

  fireEvent.click(save(first));
  await first.findByRole("button", { name: "Review recipe version 2" });
  expect(prompt(first).value).toBe("Unsaved editor A text");
  fireEvent.click(save(first));
  expect(writes().map(({ previous }) => previous)).toEqual([1, 1]);
  expect(versions[0]).toMatchObject({ version: 2, draft: { identityVersion: 2, referenceSetId: 10, settingsJson: newerSettings } });
  expect(save(first).disabled).toBe(true);

  fireEvent.click(first.getByRole("button", { name: "Load latest version into editor" }));
  expect(prompt(first).value).toBe("Updated editor B prompt");
  for (const [text,version] of [["Combined draft",3],["Next edit",4]] as const) {
    fireEvent.change(prompt(first), { target: { value: text } });
    fireEvent.click(save(first));
    await first.findByRole("button", { name: `Review recipe version ${version}` });
    expect(prompt(first).value).toBe(text);
  }
  expect(writes().map(({ previous }) => previous)).toEqual([1, 1, 2, 3]);
  expect(versions[0]).toMatchObject({ version: 4, draft: { identityVersion: 2, referenceSetId: 10, settingsJson: newerSettings } });
});

it("keeps the newly selected recipe when the old recipe reload finishes late", async () => {
  const draft: RecipeDraft = {
    identityVersion: 1, appearanceVersion: null, styleVersion: null, referenceSetId: null,
    prompt: "First recipe", negativePrompt: "", settingsJson: "{}",
  };
  type Page = { entries: { version: number; draft: RecipeDraft }[]; next: null };
  let resolveReload: ((page: Page) => void) | undefined;
  let reads = 0;
  let otherVersion = 7;
  const request = vi.fn<CharacterRequest>(async (action) => {
    switch (action.kind) {
      case "recipes":
        return { entries: [{ id: "first", name: "One" }, { id: "other", name: "Two" }], next: null };
      case "revisions": return { entries: [{ version: 1, text: "Identity" }], next: null };
      case "referenceSets": return { entries: [], next: null };
      case "recipeVersions":
        if (action.recipeId === "other")
          return { entries: [{ version: otherVersion, draft: { ...draft, prompt: "Second recipe" } }], next: null };
        if (++reads === 1) return { entries: [{ version: 1, draft }], next: null };
        return new Promise<Page>((resolve) => {resolveReload = resolve;});
      case "appendRecipe":
        if (action.recipeId === "first") throw Error("visual_assets_recipe_version_changed");
        return { version: ++otherVersion };
      default: throw Error("Unexpected recipe request");
    }
  });
  render(<GenerationRecipes id="character" disabled={false} request={request} />);
  fireEvent.click(screen.getByRole("button", { name: "Generation recipes" }));
  const choice = screen.getByRole("combobox", { name: "Choose generation recipe" });
  await screen.findByRole("option", { name: "One" });
  fireEvent.change(choice, { target: { value: "first" } });
  await screen.findByRole("button", { name: "Review recipe version 1" });
  fireEvent.click(screen.getByRole("button", { name: "Save recipe version" }));
  await waitFor(() => expect(resolveReload).toBeTypeOf("function"));
  fireEvent.change(choice, { target: { value: "other" } });
  await screen.findByRole("button", { name: "Review recipe version 7" });
  const prompt = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Generation prompt" });
  expect(prompt.value).toBe("Second recipe");
  await act(async () => resolveReload?.({ entries: [{ version: 2, draft: { ...draft, prompt: "Late first recipe" } }], next: null }));
  expect(prompt.value).toBe("Second recipe");
  expect(screen.queryByRole("button", { name: "Review recipe version 2" })).toBeNull();
  fireEvent.change(prompt, { target: { value: "Second recipe edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Save recipe version" }));
  await screen.findByRole("button", { name: "Review recipe version 8" });
  expect(request).toHaveBeenCalledWith(expect.objectContaining({
    kind: "appendRecipe", recipeId: "other", previous: 7,
    draft: expect.objectContaining({ prompt: "Second recipe edit" }),
  }));
});
