import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import type { ToolPage } from "../toolCenter/manual-tools";
import { PluginManagerViewApp } from "./PluginManagerViewApp";
import type { ManagedPlugin } from "./pluginManagerLogic";

beforeEach(() => setLocale("en"));
afterEach(cleanup);
const preview = {
  sourcePath: "C:/candidate", contentSha256: "a".repeat(64), pluginId: "com.example.json-file",
  name: "JSON File", version: "0.1.1", publisher: "example", permissions: ["resource.read"], capabilityCount: 1,
};
const packageRevision = "package-revision";
const activationReview = { packageRevision, sceneRevision: "programming:revision" };
const tool = {
  toolId: "format", accessId: "format", pluginId: preview.pluginId, capabilityId: "json.format",
  title: "Format JSON", applicationName: preview.name, publisher: "example", version: preview.version,
  enabled: true, runtime: "wasi",
};
const button = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

function setup({ required = true, existing = false, failed = false, activationFails = false, activationDelay = Promise.resolve() } = {}) {
  const permissionDetails = {
    required: required ? [{ name: "resource.read", reason: "Read the chosen JSON file" }] : [],
    optional: required ? [{ name: "pi.tools.register", reason: "Pi integration" }] : [],
  };
  const plugin: ManagedPlugin = {
    id: preview.pluginId, name: preview.name, version: preview.version, description: "JSON tools",
    enabled: existing, origin: "developer", permissionDetails, activationReview, capabilities: [tool],
    permissions: existing ? { "resource.read": true } : {},
  };
  let installed = existing;
  const activateReviewed = vi.fn(async (_id: string, _review: typeof activationReview, grants: string[]) => {
    await activationDelay;
    if (activationFails) throw new Error("Cannot save permissions");
    plugin.permissions = Object.fromEntries(grants.map((grant) => [grant, true]));
    plugin.enabled = true;
    plugin.activationReview = { ...activationReview, sceneRevision: "programming:enabled-revision" };
  });
  const setScene = vi.fn(async () => {});
  const installDeveloperPlugin = vi.fn(async () => {
    if (failed) throw new Error("Plugin package changed after preview");
    installed = true;
    return { pluginId: plugin.id, packageRevision };
  });
  const installedTools = {
    list: vi.fn(async (): Promise<ToolPage> => ({ items: [tool], revision: "directory", total: 1, nextOffset: null })),
    open: vi.fn(async () => true),
    openDirectory: vi.fn(async () => {}),
  };
  const notify = vi.fn();
  render(<PluginManagerViewApp registry={{ list: () => installed ? [plugin] : [], setScene, activateReviewed }}
    selectDeveloperPlugin={async () => preview} installDeveloperPlugin={installDeveloperPlugin}
    installedTools={installedTools} notify={notify} />);
  return { plugin, setScene, installDeveloperPlugin, activateReviewed, installedTools, notify };
}

async function reviewPackage() {
  fireEvent.click(button("Install local plugin"));
  return screen.findByRole("region", { name: "Review local plugin" });
}

async function installPackage() {
  await reviewPackage();
  fireEvent.click(button("Install reviewed plugin"));
  return screen.findByRole("region", { name: "Installed plugin setup" });
}
const setupCard = () => within(screen.getByRole("region", { name: "Installed plugin setup" }));

it("reviews exact package content then grants only the checked permission and waits before opening the actual tool", async () => {
  const flow = setup();
  const review = within(await reviewPackage());
  expect(review.getByText(/JSON File · 0\.1\.1 · example/)).toBeTruthy();
  expect(review.getByText(/resource\.read/)).toBeTruthy();
  expect(flow.installDeveloperPlugin).not.toHaveBeenCalled();
  fireEvent.click(button("Install reviewed plugin"));
  await screen.findByRole("region", { name: "Installed plugin setup" });
  expect(flow.installDeveloperPlugin).toHaveBeenCalledWith(preview.sourcePath, preview.contentSha256);
  expect(flow.setScene).toHaveBeenCalledWith("programming");
  expect(setupCard().getByRole("status").textContent).toBe("Permission required");
  expect(button("Enable plugin").disabled).toBe(true);
  expect(setupCard().getByText("Format JSON", { exact: false })).toBeTruthy();
  expect(setupCard().getByText("Read the chosen JSON file")).toBeTruthy();
  expect(flow.installedTools.list).not.toHaveBeenCalled();
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Read selected resources/ }));
  fireEvent.click(button("Authorize and enable"));
  await screen.findByRole("button", { name: "Open Format JSON" });
  expect(flow.activateReviewed).toHaveBeenCalledWith(preview.pluginId, activationReview, ["resource.read"]);
  expect(flow.plugin.permissions?.["pi.tools.register"]).toBeUndefined();
  expect(flow.installedTools.open).not.toHaveBeenCalled();
  fireEvent.click(button("Open Format JSON"));
  await waitFor(() => expect(flow.installedTools.open).toHaveBeenCalledWith(preview.pluginId, packageRevision, tool, "directory"));
});

it("lets a user cancel installation and defer permission without persisting checkbox decisions", async () => {
  const flow = setup();
  await reviewPackage();
  fireEvent.click(button("Cancel"));
  expect(flow.installDeveloperPlugin).not.toHaveBeenCalled();
  await installPackage();
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Read selected resources/ }));
  fireEvent.click(button("Keep disabled"));
  expect(flow.activateReviewed).not.toHaveBeenCalled();
  expect(flow.plugin.enabled).toBe(false);
  expect(setupCard().getByRole("status").textContent).toBe("Permission required");
  fireEvent.click(setupCard().getByRole("button", { name: "Review and enable" }));
  expect(setupCard().getByRole<HTMLInputElement>("checkbox", { name: /Read selected resources/ }).checked).toBe(false);
  expect(button("Enable plugin").disabled).toBe(true);
});

it("explicitly enables a permission-free package and keeps existing enablement on repeat install", async () => {
  const flow = setup({ required: false });
  await installPackage();
  expect(flow.activateReviewed).not.toHaveBeenCalled();
  expect(setupCard().getByRole("status").textContent).toBe("Disabled");
  expect(setupCard().getByText("No permissions requested")).toBeTruthy();
  fireEvent.click(button("Enable plugin"));
  await screen.findByRole("button", { name: "Open Format JSON" });
  expect(flow.activateReviewed).toHaveBeenCalledWith(preview.pluginId, activationReview, []);
  await installPackage();
  await waitFor(() => expect(flow.installDeveloperPlugin).toHaveBeenCalledTimes(2));
  expect(flow.activateReviewed).toHaveBeenCalledTimes(1);
  expect(flow.plugin.enabled).toBe(true);
});

it("leaves an existing enabled package alone on failed reinstallation", async () => {
  const flow = setup({ existing: true, failed: true });
  await reviewPackage();
  fireEvent.click(button("Install reviewed plugin"));
  await waitFor(() => expect(flow.notify).toHaveBeenCalledWith("The plugin package changed after preview. Select it again."));
  expect(flow.plugin.enabled).toBe(true);
  expect(flow.plugin.permissions).toEqual({ "resource.read": true });
  expect(flow.activateReviewed).not.toHaveBeenCalled();
  expect(flow.installedTools.open).not.toHaveBeenCalled();
});

it("shows failure without reporting availability or implicitly opening anything", async () => {
  const flow = setup({ activationFails: true });
  await installPackage();
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Read selected resources/ }));
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Make tools available to Pi/ }));
  fireEvent.click(button("Authorize and enable"));
  await waitFor(() => expect(flow.notify).toHaveBeenCalledWith("Cannot save permissions"));
  expect(flow.activateReviewed).toHaveBeenCalledWith(preview.pluginId, activationReview, ["resource.read", "pi.tools.register"]);
  expect(setupCard().getByRole("status").textContent).toBe("Permission required");
  expect(flow.plugin.permissions).toEqual({});
  expect(flow.installedTools.list).not.toHaveBeenCalled();
});


function clickFocused(control: HTMLElement) {
  control.focus();
  fireEvent.click(control);
}

it("hands keyboard focus from deferral to review, then the required permission", async () => {
  setup();
  await installPackage();
  clickFocused(button("Keep disabled"));
  const review = setupCard().getByRole("button", { name: "Review and enable" });
  expect(document.activeElement).toBe(review);
  clickFocused(review);
  expect(document.activeElement).toBe(setupCard().getByRole("checkbox", { name: /Read selected resources/ }));
});

it("places focus on the available next action after the reviewed revision changes", async () => {
  const flow = setup({ required: false });
  await installPackage();
  clickFocused(button("Keep disabled"));
  clickFocused(setupCard().getByRole("button", { name: "Review and enable" }));
  const enable = button("Enable plugin");
  expect(document.activeElement).toBe(enable);
  clickFocused(enable);
  await screen.findByRole("button", { name: "Open Format JSON" });
  expect(document.activeElement).toBe(button("Open Tool Center"));
  expect(flow.installedTools.open).not.toHaveBeenCalled();
});

it("returns focus to retry after a permission write fails", async () => {
  const flow = setup({ activationFails: true });
  await installPackage();
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Read selected resources/ }));
  const authorize = button("Authorize and enable");
  clickFocused(authorize);
  await waitFor(() => expect(flow.notify).toHaveBeenCalledWith("Cannot save permissions"));
  expect(document.activeElement).toBe(authorize);
  expect(authorize.disabled).toBe(false);
});

it("keeps focus where the user moved it while activation was running", async () => {
  let resolveActivation!: () => void;
  const activationDelay = new Promise<void>(resolve => { resolveActivation = resolve; });
  setup({ required: false, activationDelay });
  await installPackage();
  clickFocused(button("Enable plugin"));
  const search = screen.getByRole("searchbox", { name: "Search plugins and tools" });
  search.focus();
  resolveActivation();
  await screen.findByRole("button", { name: "Open Format JSON" });
  expect(document.activeElement).toBe(search);
});
