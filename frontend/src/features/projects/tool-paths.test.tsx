import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { ProjectToolPaths, type ToolPathSettings, type ToolPathsApi } from "./ProjectToolPaths";

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});
function api(): ToolPathsApi {
  return {
    canEdit: true,
    read: vi.fn(async () => ({ revision: 3, directories: ["/tools/node"] })),
    save: vi.fn(async (_workspace, settings) => ({ ...settings, revision: settings.revision + 1 })),
  };
}
it("loads ordered paths, saves explicitly and clears to host defaults with the latest revision", async () => {
  const service = api();
  render(<ProjectToolPaths workspace="a" api={service} />);
  const editor = await screen.findByDisplayValue("/tools/node");
  expect(service.save).not.toHaveBeenCalled();
  fireEvent.change(editor, { target: { value: "/tools/rust\n/tools/node\n" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tool directories" }));
  await screen.findByText("Tool directories saved. Environment results are being refreshed.");
  expect(service.save).toHaveBeenCalledWith("a", {
    revision: 3,
    directories: ["/tools/rust", "/tools/node"],
  });
  fireEvent.change(editor, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save tool directories" }));
  await waitFor(() =>
    expect(service.save).toHaveBeenLastCalledWith("a", { revision: 4, directories: [] }),
  );
});
it("keeps a conflicting draft and requires an explicit reload before another save", async () => {
  const service = api();
  service.save = vi.fn(async () => {
    throw new Error("project_environment_conflict");
  });
  render(<ProjectToolPaths workspace="a" api={service} />);
  fireEvent.change(await screen.findByDisplayValue("/tools/node"), {
    target: { value: "/my/draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save tool directories" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Your draft is kept");
  expect(screen.getByDisplayValue("/my/draft")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Save tool directories" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved tool directories" }));
  await screen.findByDisplayValue("/tools/node");
  expect(service.save).toHaveBeenCalledTimes(1);
});
it("discards late reads from a previous project", async () => {
  let finish!: (settings: ToolPathSettings) => void;
  const service = api();
  service.read = vi.fn((workspace) =>
    workspace === "a"
      ? new Promise<ToolPathSettings>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ revision: 1, directories: ["/b/tools"] }),
  );
  const view = render(<ProjectToolPaths workspace="a" api={service} />);
  view.rerender(<ProjectToolPaths workspace="b" api={service} />);
  await screen.findByDisplayValue("/b/tools");
  await act(async () => finish({ revision: 10, directories: ["/a/tools"] }));
  expect(screen.queryByDisplayValue("/a/tools")).toBeNull();
  expect(screen.getByDisplayValue("/b/tools")).toBeTruthy();
});
it("does not load machine paths for remote clients", () => {
  const service = { ...api(), canEdit: false };
  render(<ProjectToolPaths workspace="a" api={service} />);
  expect(service.read).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("ignores a completed save after switching projects", async () => {
  const service = api();
  let finish!: (settings: ToolPathSettings) => void;
  service.read = vi.fn(async (workspace) => ({
    revision: 1,
    directories: [`/${workspace}/tools`],
  }));
  service.save = vi.fn(
    () =>
      new Promise<ToolPathSettings>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ProjectToolPaths workspace="a" api={service} />);
  await screen.findByDisplayValue("/a/tools");
  fireEvent.click(screen.getByRole("button", { name: "Save tool directories" }));
  view.rerender(<ProjectToolPaths workspace="b" api={service} />);
  await screen.findByDisplayValue("/b/tools");
  await act(async () => finish({ revision: 2, directories: ["/a/saved"] }));
  expect(screen.queryByDisplayValue("/a/saved")).toBeNull();
  expect(screen.getByDisplayValue("/b/tools")).toBeTruthy();
});
it("bounds the directory count and keeps edits after a validation failure", async () => {
  const service = api();
  render(<ProjectToolPaths workspace="a" api={service} />);
  fireEvent.change(await screen.findByDisplayValue("/tools/node"), {
    target: { value: Array.from({ length: 9 }, (_, i) => `/tools/${i}`).join("\n") },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save tool directories" }));
  expect((await screen.findByRole("alert")).textContent).toContain("at most eight");
  expect(service.save).not.toHaveBeenCalled();
});
