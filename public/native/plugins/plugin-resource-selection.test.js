import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createPluginResourceSelection } from "./plugin-resource-selection.js";

function setup(projectFiles) {
  setLocale("en");
  vi.stubGlobal("crypto", webcrypto);
  document.body.innerHTML = '<main id="parent"></main>';
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const gateway = {
    ...(projectFiles ? { projectFiles } : {}),
    prepareResource: vi.fn(async () => ({ resourceId: id })),
    appendResource: vi.fn(async () => ({ uploadedBytes: 3 })),
    commitResource: vi.fn(async (access) => ({ ...access, confirmed: true, byteLength: 3 })),
    revokeResource: vi.fn(async () => ({})),
  };
  const onResource = vi.fn();
  const controller = createPluginResourceSelection({
    container: document.querySelector("main"),
    plugin: { id: "p", name: "Receiver", version: "1", capabilities: [{ id: "c", title: "Echo" }] },
    target: { instanceId: "r", sessionId: "s", workspaceId: "ws" },
    gateway,
    isCurrent: () => true,
    onResource,
  });
  const file = {
    name: "test.txt",
    size: 3,
    type: "text/plain",
    arrayBuffer: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  };
  const input = document.querySelector('input[type="file"]');
  Object.defineProperty(input, "files", { value: [file] });
  input.dispatchEvent(new Event("change"));
  return {
    controller,
    gateway,
    onResource,
    file,
    input,
    confirm: [...document.querySelectorAll("button")].find(button => button.textContent === "Confirm file sharing"),
    cancel: [...document.querySelectorAll("button")].find(button => button.textContent === "Cancel file sharing"),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  setLocale("zh-CN");
});
describe("trusted file confirmation controls", () => {
  it("retains the in-flight project grant for cancellation and revokes a late result", async () => {
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const access = { schemaVersion: 1, owner, resourceId: id, contentVersion: "a".repeat(64) };
    let release;
    const projectFiles = { choose: vi.fn(async () => "input.txt"),
      prepare: vi.fn(async () => ({ profile: "resource.local-file.draft1", grantId: id, owner, relativePath: "input.txt", byteLength: 3, contentRead: false, confirmed: false })),
      commit: vi.fn(() => new Promise(resolve => { release = resolve; })), cancel: vi.fn(async () => ({ cancellationRequested: true, executionFinished: false })),
      status: vi.fn(async () => ({ schemaVersion: 1, phase: "reading", executionFinished: false, cancellationRequested: true, contentRead: null })) };
    const options = setup(projectFiles);
    [...document.querySelectorAll("button")].find(button => button.textContent === "Choose from current project").click();
    await vi.waitFor(() => expect(options.confirm.disabled).toBe(false));
    options.confirm.click();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    options.cancel.click();
    expect(projectFiles.cancel).toHaveBeenCalledWith(owner, id);
    expect(document.body.textContent).toContain("Waiting for preparation to finish");
    expect(options.input.disabled).toBe(true);
    await vi.waitFor(() => expect(projectFiles.status).toHaveBeenCalledWith(owner, id));
    expect(document.body.textContent).toContain("file preparation has not ended");
    projectFiles.status.mockResolvedValue({ schemaVersion: 1, phase: "ended", executionFinished: true, outcome: "published", contentRead: true });
    release({ ...access, access, confirmed: true, profile: "resource.local-file.draft1", byteLength: 3 });
    await vi.waitFor(() => expect(options.input.disabled).toBe(false));
    expect(document.body.textContent).not.toContain("Waiting for preparation to finish");
    expect(options.onResource).not.toHaveBeenCalled();
    expect(options.gateway.revokeResource).toHaveBeenCalledWith(access);
    await vi.waitFor(() => expect(projectFiles.status).toHaveBeenCalledTimes(2));
    expect(document.body.textContent).toContain("does not restore the file");
    options.controller.destroy();
  });
  it("checks the receipt after a failed confirmation without automatically reading again", async () => {
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const projectFiles = { choose: vi.fn(async () => "input.txt"),
      prepare: vi.fn(async () => ({ profile: "resource.local-file.draft1", grantId: id, owner, relativePath: "input.txt", byteLength: 3, contentRead: false, confirmed: false })),
      commit: vi.fn(async () => { throw new Error("timeout"); }), cancel: vi.fn(async () => ({})),
      status: vi.fn(async () => ({ schemaVersion: 1, phase: "ended", executionFinished: true, outcome: "published", contentRead: true })) };
    const options = setup(projectFiles);
    [...document.querySelectorAll("button")].find(button => button.textContent === "Choose from current project").click();
    await vi.waitFor(() => expect(options.confirm.disabled).toBe(false));
    options.confirm.click();
    await vi.waitFor(() => expect(projectFiles.status).toHaveBeenCalledOnce());
    expect(document.body.textContent).toContain("Check preparation status before selecting again");
    expect(document.body.textContent).toContain("does not restore the file");
    expect(projectFiles.prepare).toHaveBeenCalledOnce(); expect(projectFiles.commit).toHaveBeenCalledOnce();
    expect(options.onResource).not.toHaveBeenCalled();
    options.controller.destroy();
  });
  it("shows a launch file name without preparing or confirming it automatically", async () => {
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    const projectFiles = { entry: vi.fn(async () => "中文.zip"), choose: vi.fn(),
      prepare: vi.fn(async () => ({ profile: "resource.local-file.draft1", grantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner, relativePath: "中文.zip", byteLength: 3, contentRead: false, confirmed: false })),
      commit: vi.fn(), cancel: vi.fn(async () => ({})) };
    const options = setup(projectFiles);
    await vi.waitFor(() => expect(document.body.textContent).toContain("Use opened file: 中文.zip"));
    expect(projectFiles.prepare).not.toHaveBeenCalled();
    const button = [...document.querySelectorAll("button")].find(button => button.textContent === "Use opened file: 中文.zip");
    button.click();
    await vi.waitFor(() => expect(projectFiles.prepare).toHaveBeenCalledOnce());
    expect(projectFiles.choose).not.toHaveBeenCalled();
    expect(projectFiles.commit).not.toHaveBeenCalled();
    options.controller.destroy();
  });
  it("selects a project snapshot only after separate confirmation and cancels pending metadata grants", async () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    const access = { schemaVersion: 1, owner, resourceId: id, contentVersion: "a".repeat(64) };
    const projectFiles = { choose: vi.fn(async () => "中文.zip"), prepare: vi.fn(async () => ({ profile: "resource.local-file.draft1", grantId: id, owner, relativePath: "中文.zip", byteLength: 3, contentRead: false, confirmed: false })),
      commit: vi.fn(async () => ({ ...access, access, confirmed: true, profile: "resource.local-file.draft1", byteLength: 3 })), cancel: vi.fn(async () => ({})) };
    const options = setup(projectFiles);
    const choose = [...document.querySelectorAll("button")].find(button => button.textContent === "Choose from current project");
    choose.click();
    await vi.waitFor(() => expect(options.confirm.disabled).toBe(false));
    expect(document.body.textContent).toContain("中文.zip");
    expect(projectFiles.commit).not.toHaveBeenCalled(); expect(options.gateway.prepareResource).not.toHaveBeenCalled();
    expect(projectFiles.choose).toHaveBeenCalledWith("ws");
    options.cancel.click(); expect(projectFiles.cancel).toHaveBeenCalledWith(owner, id);
    choose.click(); await vi.waitFor(() => expect(options.confirm.disabled).toBe(false));
    options.confirm.click();
    await vi.waitFor(() => expect(options.onResource).toHaveBeenLastCalledWith({ capabilityId: "c", resourceId: id, contentVersion: "a".repeat(64) }));
    expect(projectFiles.commit).toHaveBeenCalledOnce();
    expect(options.gateway.appendResource).not.toHaveBeenCalled();
    options.controller.destroy();
  });
  it("shows metadata without reading or sending bytes before confirmation", () => {
    const options = setup();
    expect(document.body.textContent).toContain("test.txt");
    expect(options.file.arrayBuffer).not.toHaveBeenCalled();
    expect(options.gateway.prepareResource).not.toHaveBeenCalled();
    options.cancel.click();
    expect(options.confirm.disabled).toBe(true);
  });
  it("confirms before delivering a reference and revokes on cancel", async () => {
    const options = setup();
    options.confirm.click();
    await vi.waitFor(() => expect(options.onResource).toHaveBeenCalledTimes(1));
    expect(options.gateway.prepareResource).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" },
      }),
    );
    options.cancel.click();
    expect(options.onResource).toHaveBeenLastCalledWith(null);
    expect(options.gateway.revokeResource).toHaveBeenCalledTimes(1);
  });
  it("keeps allocation controls disabled until canceled work finishes", async () => {
    const options = setup();
    let release;
    options.gateway.prepareResource.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    options.confirm.click();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    options.cancel.click();
    expect(options.input.disabled).toBe(true);
    release({ resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    await vi.waitFor(() => expect(options.input.disabled).toBe(false));
    expect(options.onResource).not.toHaveBeenCalled();
    expect(options.gateway.revokeResource).toHaveBeenCalledTimes(1);
  });
});
