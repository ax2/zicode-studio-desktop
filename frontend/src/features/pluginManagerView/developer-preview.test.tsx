import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import type { ToolPage } from "../toolCenter/manual-tools";
import { LocalPluginActivationCard, type InstalledToolActions } from "./LocalPluginActivationCard";
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

function setup({ required = true, existing = false, failed = false, activationFails = false, activationDelay = Promise.resolve(),
  getTarget = () => ({ sceneId: "programming", workspaceId: "fixture" }),
} = {}) {
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
    return { settingsLoaded: true };
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
    getTarget={getTarget} selectDeveloperPlugin={async () => preview} installDeveloperPlugin={installDeveloperPlugin}
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

it.each([true, false])("recovers a saved installation with required permissions %s using only a registry read", async required => {
  const flow = setup({ required });
  flow.setScene.mockRejectedValueOnce(Error("Synthetic registry error"));
  await reviewPackage();
  fireEvent.click(button("Install reviewed plugin"));
  await screen.findByRole("alert");
  expect(screen.getByText("Plugin installed. Its settings could not be loaded.")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Review local plugin" })).toBeNull();
  expect(flow.installDeveloperPlugin).toHaveBeenCalledTimes(1);
  expect(flow.activateReviewed).not.toHaveBeenCalled();

  let finish!: () => void;
  flow.setScene.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const retry = button("Reload plugin settings");
  retry.focus();
  fireEvent.click(retry);
  fireEvent.click(retry);
  expect(retry.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(retry);
  expect(flow.setScene.mock.calls).toEqual([["programming"], ["programming"]]);
  await act(async () => finish());
  await screen.findByRole("region", { name: "Installed plugin setup" });
  expect(button("Enable plugin").disabled).toBe(required);
  expect(flow.installDeveloperPlugin).toHaveBeenCalledTimes(1);
  expect(flow.activateReviewed).not.toHaveBeenCalled();
});

it.each(["switch workspace", "dismiss feedback", "move focus", "replace package"] as const)(
  "guards a delayed installation refresh when the user decides to %s", async outcome => {
    let target = { sceneId: "programming", workspaceId: "fixture" };
    const flow = setup({ required: false, getTarget: () => target });
    flow.setScene.mockRejectedValueOnce(Error("Synthetic registry error"));
    await reviewPackage();
    fireEvent.click(button("Install reviewed plugin"));
    await screen.findByRole("alert");
    let finish!: () => void;
    flow.setScene.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const retry = button("Reload plugin settings");
    retry.focus();
    fireEvent.click(retry);
    if (outcome === "switch workspace") target = { ...target, workspaceId: "another" };
    if (outcome === "dismiss feedback") fireEvent.click(button("Close"));
    if (outcome === "replace package") {
      flow.plugin.activationReview = { ...activationReview, packageRevision: "replacement" };
    }
    const search = screen.getByRole("searchbox");
    search.focus();
    await act(async () => finish());
    expect(document.activeElement).toBe(search);
    if (outcome === "move focus") {
      expect(setupCard().getByRole("button", { name: "Enable plugin" })).toBeTruthy();
    } else {
      expect(screen.queryByRole("region", { name: "Installed plugin setup" })).toBeNull();
      if (outcome === "replace package") {
        expect(screen.getByText("Plugin or permissions changed. Review them again.")).toBeTruthy();
      }
    }
    expect(flow.installDeveloperPlugin).toHaveBeenCalledTimes(1);
    expect(flow.activateReviewed).not.toHaveBeenCalled();
  },
);

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


it("reloads a stale rejected review without reusing its permission draft", async () => {
  const flow = setup();
  await installPackage();
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Read selected resources/ }));
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Make tools available to Pi/ }));
  const latestReview = { ...activationReview, sceneRevision: "programming:changed" };
  flow.activateReviewed.mockRejectedValueOnce(new Error("Plugin or permissions changed after review; review them again"));
  clickFocused(button("Authorize and enable"));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Plugin or permissions changed. Review them again.");
  const retry = button("Reload plugin settings");
  expect(document.activeElement).toBe(retry);
  expect(screen.queryByRole("button", { name: "Authorize and enable" })).toBeNull();
  expect(flow.setScene).toHaveBeenCalledTimes(1);
  expect(flow.installedTools.list).not.toHaveBeenCalled();

  flow.setScene.mockImplementationOnce(async () => { flow.plugin.activationReview = latestReview; });
  clickFocused(retry);
  await screen.findByRole("region", { name: "Installed plugin setup" });
  expect(flow.setScene).toHaveBeenCalledTimes(2);
  expect(flow.activateReviewed).toHaveBeenCalledTimes(1);
  expect(flow.installDeveloperPlugin).toHaveBeenCalledTimes(1);
  expect(setupCard().getByRole<HTMLInputElement>("checkbox", { name: /Make tools available to Pi/ }).checked).toBe(false);
  expect(button("Enable plugin").disabled).toBe(true);
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Read selected resources/ }));
  clickFocused(button("Authorize and enable"));
  await screen.findByRole("button", { name: "Open Format JSON" });
  expect(flow.activateReviewed).toHaveBeenLastCalledWith(preview.pluginId, latestReview, ["resource.read"]);
  expect(flow.plugin.permissions?.["pi.tools.register"]).toBeUndefined();
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

it("recovers the settings of a confirmed activation without applying its grants again", async () => {
  const flow = setup();
  await installPackage();
  flow.activateReviewed.mockResolvedValueOnce({ settingsLoaded: false });
  flow.setScene.mockRejectedValueOnce(Error("Still unavailable")).mockImplementationOnce(async () => {
    flow.plugin.enabled = true;
    flow.plugin.permissions = { "resource.read": true };
    flow.plugin.activationReview = { ...activationReview, sceneRevision: "programming:enabled-revision" };
  });
  fireEvent.click(setupCard().getByRole("checkbox", { name: /Read selected resources/ }));
  clickFocused(button("Authorize and enable"));
  expect((await screen.findByRole("alert")).textContent).toBe("Plugin enabled. Its settings could not be loaded.");
  expect(screen.queryByRole("button", { name: "Authorize and enable" })).toBeNull();
  expect(button("Review and enable").disabled).toBe(true);
  const retry = button("Reload plugin settings");
  expect(document.activeElement).toBe(retry);
  clickFocused(retry);
  await screen.findByRole("alert");
  expect(button("Review and enable").disabled).toBe(true);
  expect(document.activeElement).toBe(retry);
  clickFocused(retry);
  const enabledCard = await screen.findByRole("region", { name: "Installed plugin setup" });
  await within(enabledCard).findByRole("button", { name: "Open Format JSON" });
  expect(flow.setScene.mock.calls).toEqual([["programming"], ["programming"], ["programming"]]);
  expect(flow.activateReviewed.mock.calls).toEqual([[preview.pluginId, activationReview, ["resource.read"]]]);
  expect(flow.plugin.permissions?.["pi.tools.register"]).toBeUndefined();
  expect(flow.installedTools.open).not.toHaveBeenCalled();
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

it("retries listing the same installed package and opens a tool only after the user chooses it", async () => {
  const flow = setup({ required: false });
  flow.installedTools.list.mockRejectedValueOnce(Error("Unavailable")).mockRejectedValueOnce(Error("Still unavailable"));
  await installPackage();
  clickFocused(button("Enable plugin"));
  const retry = () => setupCard().getByRole("button", { name: "Try again" });
  await setupCard().findByRole("button", { name: "Try again" });
  clickFocused(retry());
  await setupCard().findByRole("button", { name: "Try again" });
  expect(document.activeElement).toBe(retry());
  clickFocused(retry());
  const direct = await setupCard().findByRole("button", { name: "Open Format JSON" });
  expect(document.activeElement).toBe(direct);
  expect(flow.installedTools.list.mock.calls).toEqual([
    [preview.pluginId, packageRevision], [preview.pluginId, packageRevision], [preview.pluginId, packageRevision],
  ]);
  expect(flow.installedTools.open).not.toHaveBeenCalled();
  expect(flow.installedTools.openDirectory).not.toHaveBeenCalled();
  expect(flow.activateReviewed).toHaveBeenCalledTimes(1);
  fireEvent.click(direct);
  await waitFor(() => expect(flow.installedTools.open).toHaveBeenCalledWith(preview.pluginId, packageRevision, tool, "directory"));
});

it.each(["tool", "directory"] as const)("keeps the opening %s action focused and suppresses duplicate navigation", async target => {
  const flow = setup({ required: false });
  let finishOpening!: () => void;
  const delay = new Promise<void>(resolve => { finishOpening = resolve; });
  if (target === "tool") {
    flow.installedTools.open.mockImplementationOnce(async () => {
      await delay;
      return false;
    });
  } else {
    flow.installedTools.openDirectory.mockImplementationOnce(async () => {
      await delay;
      throw Error("Could not open the directory");
    });
  }
  await installPackage();
  fireEvent.click(button("Enable plugin"));
  const toolButton = await setupCard().findByRole("button", { name: "Open Format JSON" });
  const directoryButton = setupCard().getByRole("button", { name: "Open Tool Center" });
  const pressed = target === "tool" ? toolButton : directoryButton;
  const open = target === "tool" ? flow.installedTools.open : flow.installedTools.openDirectory;

  clickFocused(pressed);
  expect(pressed.hasAttribute("disabled")).toBe(false);
  expect(toolButton.getAttribute("aria-disabled")).toBe("true");
  expect(directoryButton.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(toolButton);
  fireEvent.click(directoryButton);
  expect(flow.installedTools.open).toHaveBeenCalledTimes(target === "tool" ? 1 : 0);
  expect(flow.installedTools.openDirectory).toHaveBeenCalledTimes(target === "directory" ? 1 : 0);
  await act(async () => finishOpening());

  expect(flow.notify).toHaveBeenCalledWith(target === "tool" ? "Could not open this tool. Try again." : "Could not open the directory");
  expect(document.activeElement).toBe(pressed);
  expect(pressed.hasAttribute("aria-disabled")).toBe(false);
  fireEvent.click(pressed);
  await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
  expect(flow.activateReviewed).toHaveBeenCalledTimes(1);
});

it.each(["packageRevision", "sceneRevision"] as const)("ignores a late retry after the installed %s changes", async field => {
  let resolveOld!: (value: ToolPage) => void;
  let resolveCurrent!: (value: ToolPage) => void;
  const pending = new Promise<ToolPage>(resolve => { resolveOld = resolve; });
  const current = new Promise<ToolPage>(resolve => { resolveCurrent = resolve; });
  const oldPage = { items: [{ ...tool, title: "Old tool response" }], revision: "old-list", total: 1, nextOffset: null };
  const currentPage = { items: [tool], revision: "new-list", total: 1, nextOffset: null };
  const installedTools = {
    list: vi.fn<InstalledToolActions["list"]>()
      .mockRejectedValueOnce(Error("Unavailable")).mockReturnValueOnce(pending).mockReturnValueOnce(current),
    open: vi.fn(async () => true),
    openDirectory: vi.fn(async () => {}),
  };
  const plugin: ManagedPlugin = {
    id: preview.pluginId, name: preview.name, description: "Synthetic plugin", version: preview.version,
    enabled: true, activationReview,
  };
  const props = {
    busy: false, deferred: false, installedTools,
    onClose: vi.fn(), onDefer: vi.fn(), onResume: vi.fn(), onError: vi.fn(),
  };
  const card = (p: ManagedPlugin) => <><input aria-label="Outside search" /><LocalPluginActivationCard plugin={p} {...props}/></>;
  const view = render(card(plugin));
  clickFocused(await setupCard().findByRole("button", { name: "Try again" }));
  const outside = screen.getByRole("textbox", { name: "Outside search" });
  outside.focus();
  const review = { ...activationReview, [field]: "replacement" };
  view.rerender(card({ ...plugin, activationReview: review }));
  await waitFor(() => expect(installedTools.list).toHaveBeenLastCalledWith(plugin.id, review.packageRevision));
  await act(async () => resolveOld(oldPage));
  expect(setupCard().queryByRole("button", { name: "Open Old tool response" })).toBeNull();
  expect(setupCard().getByText("Finding available tools…")).toBeTruthy();
  await act(async () => resolveCurrent(currentPage));
  expect(setupCard().getByRole("button", { name: "Open Format JSON" })).toBeTruthy();
  expect(document.activeElement).toBe(outside);
  expect(installedTools.open).not.toHaveBeenCalled();
});

it("reads the latest authorization review after revocation and retries without writing permissions", async () => {
  const currentReview = { packageRevision, sceneRevision: "programming:revoked" };
  const plugin: ManagedPlugin = {
    id: preview.pluginId, name: preview.name, description: "", origin: "developer", enabled: false,
    permissions: { "resource.read": false }, permissionDetails: { required: [{ name: "resource.read" }] },
    activationReview,
  };
  const setScene = vi.fn().mockRejectedValueOnce(Error("Registry unavailable")).mockImplementationOnce(async () => {
    plugin.activationReview = currentReview;
  });
  const activateReviewed = vi.fn(async () => ({ settingsLoaded: true }));
  render(<PluginManagerViewApp registry={{ list: () => [plugin], setScene, activateReviewed }} />);

  fireEvent.click(button("Review and enable"));
  await screen.findByRole("alert");
  expect(activateReviewed).not.toHaveBeenCalled();
  fireEvent.click(button("Reload plugin settings"));
  const required = await screen.findByRole("checkbox");
  fireEvent.click(required);
  fireEvent.click(button("Authorize and enable"));
  await waitFor(() => expect(activateReviewed).toHaveBeenCalledWith(plugin.id, currentReview, ["resource.read"]));
  expect(setScene.mock.calls).toEqual([["programming"], ["programming"]]);
  expect(activateReviewed).toHaveBeenCalledTimes(1);
});
