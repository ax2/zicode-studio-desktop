import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ProjectMain } from "./ProjectWorkspaceApp";
import { ProjectProfilePreview } from "./ProjectProfilePreview";
import { createProjectWorkspaceStore } from "./store";

afterEach(() => { cleanup(); setLocale("zh-CN"); });

it.each(["finance", "legacy-personal"])("simplifies editing while preserving existing %s startup data", async defaultScene => {
  setLocale("en");
  let profile = { instructions: "Original context", defaultScene, budget: "12" };
  const call = vi.fn(async (operation: string, params?: unknown) => {
    if (operation === "write_project_profile") profile = (params as { profile: typeof profile }).profile;
    return { ok: true, data: { profile, revision: "a".repeat(64) } };
  });
  const store = createProjectWorkspaceStore({ call, storage: null, getTarget: () => ({ cwd: "C:/simple-context-fixture" }) });
  await store.getState().load(); store.getState().setActiveView("context");
  const view = render(<ProjectMain store={store} />);
  expect(view.container.querySelector("#project-scene")).toBeNull();
  expect(view.container.textContent).not.toMatch(/scene/i);
  fireEvent.change(view.container.querySelector("#project-instructions") as HTMLTextAreaElement, { target: { value: "Changed instructions" } });
  fireEvent.change(view.container.querySelector("#project-budget") as HTMLInputElement, { target: { value: "15" } });
  fireEvent.submit(view.container.querySelector("form") as HTMLFormElement);
  await waitFor(() => expect(profile.instructions).toBe("Changed instructions"));
  expect(profile).toEqual({ instructions: "Changed instructions", defaultScene, budget: "15" });
  expect(store.getState().profile.defaultScene).toBe(defaultScene);
  store.getState().setTarget(null);
});

it("omits internal startup identifiers from read-only recovery previews", () => {
  setLocale("en");
  const view = render(<ProjectProfilePreview profile={{ instructions: "Original context", defaultScene: "legacy-personal", budget: "7" }} />);
  expect(view.container.textContent).toContain("Original context"); expect(view.container.textContent).toContain("7");
  expect(view.container.textContent).not.toMatch(/scene|legacy-personal/i);
});

it.each(["saved", "draft"] as const)("keeps historical startup conflicts resolvable with an explicit %s choice", async choice => {
  setLocale("en");
  let profile = { instructions: "Original context", defaultScene: "programming", budget: "12" }, revision = "a".repeat(64);
  const call = vi.fn(async (operation: string, params?: unknown) => {
    if (operation === "write_project_profile") profile = (params as { profile: typeof profile }).profile;
    return { ok: true, data: { profile, revision } };
  });
  const store = createProjectWorkspaceStore({ call, storage: null, getTarget: () => ({ cwd: "C:/legacy-context-fixture" }) });
  await store.getState().load();
  store.getState().setContextDraft({ defaultScene: "finance" });
  profile = { ...profile, defaultScene: "creation" }; revision = "b".repeat(64);
  await store.getState().loadProfile(); store.getState().setActiveView("context");
  const view = render(<ProjectMain store={store} />);
  expect(store.getState().contextConflicts).toEqual(["defaultScene"]);
  expect(view.getByText("Earlier version settings")).toBeTruthy();
  expect((view.getByRole("button", { name: "Save project context" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole("button", { name: choice === "saved" ? "Use saved value" : "Keep my edit" }));
  expect(store.getState().contextConflicts).toEqual([]);
  fireEvent.submit(view.container.querySelector("form") as HTMLFormElement);
  await waitFor(() => expect(call.mock.calls.some(([operation]) => operation === "write_project_profile")).toBe(true));
  expect(profile.defaultScene).toBe(choice === "saved" ? "creation" : "finance");
  expect(profile.instructions).toBe("Original context"); expect(profile.budget).toBe("12");
  store.getState().setTarget(null);
});
