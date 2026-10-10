import { describe, expect, it, vi } from "vitest";
import { readPluginViewResource, resourceViewTarget } from "./plugin-view-resource.js";

const params = {
  capabilityId: "image.process",
  resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contentVersion: "a".repeat(64),
  offset: 0,
  length: 3,
};
const target = {
  instanceId: "runtime",
  sessionId: "session",
  workspaceId: "workspace",
  sceneId: "programming",
};
const reply = {
  schemaVersion: 1,
  resourceId: params.resourceId,
  contentVersion: params.contentVersion,
  offset: 0,
  byteLength: 3,
  eof: true,
  dataBase64: "AP8B",
};
function setup(result = reply) {
  return {
    instance: { plugin: { id: "self" } },
    target,
    params,
    isCurrent: () => true,
    gateway: { readResource: vi.fn(async () => ({ ...result, privateToken: "never-forward" })) },
  };
}
describe("isolated plugin resource reads", () => {
  it("binds the parent runtime and plugin and strips unknown response fields", async () => {
    const options = setup();
    expect(await readPluginViewResource(options)).toEqual(reply);
    expect(options.gateway.readResource).toHaveBeenCalledWith(
      {
        runtimeId: "runtime",
        sessionId: "session",
        pluginId: "self",
        capabilityId: params.capabilityId,
      },
      {
        resourceId: params.resourceId,
        contentVersion: params.contentVersion,
        offset: 0,
        length: 3,
      },
    );
  });
  it.each([
    { owner: {} },
    { runtimeId: "other" },
    { pluginId: "other" },
    { length: 32769 },
    { offset: -1 },
    { offset: 1.5 },
    { contentVersion: "wrong" },
  ])("rejects overrides and invalid ranges %j", async (bad) => {
    const options = setup();
    options.params = { ...params, ...bad };
    await expect(readPluginViewResource(options)).rejects.toThrow("resource_request_invalid");
    expect(options.gateway.readResource).not.toHaveBeenCalled();
  });
  it.each([
    { resourceId: "wrong" },
    { contentVersion: "b".repeat(64) },
    { offset: 1 },
    { byteLength: 4 },
    { dataBase64: "AP8B=" },
    { eof: "true" },
  ])("rejects mismatched output %j", async (bad) => {
    await expect(readPluginViewResource(setup({ ...reply, ...bad }))).rejects.toThrow(
      "resource_response_invalid",
    );
  });
  it("rejects obsolete views before or after Host work", async () => {
    const options = setup();
    options.isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await expect(readPluginViewResource(options)).rejects.toThrow("resource_view_changed");
    options.isCurrent = () => false;
    options.gateway.readResource.mockClear();
    await expect(readPluginViewResource(options)).rejects.toThrow("resource_view_changed");
    expect(options.gateway.readResource).not.toHaveBeenCalled();
  });
  it("returns only fixed errors and handles unavailable runtimes", async () => {
    const options = setup();
    options.gateway.readResource.mockRejectedValue({ code: "resource_busy", message: "private" });
    await expect(readPluginViewResource(options)).rejects.toThrow("[resource_busy]");
    options.gateway.readResource.mockRejectedValue(new Error("private"));
    await expect(readPluginViewResource(options)).rejects.toThrow("[resource_read_failed]");
    options.target = {};
    await expect(readPluginViewResource(options)).rejects.toThrow("resource_view_changed");
  });
  it("avoids target identity collisions from delimiters", () => {
    expect(resourceViewTarget({ ...target, instanceId: "a\nb", sessionId: "c" })).not.toBe(
      resourceViewTarget({ ...target, instanceId: "a", sessionId: "b\nc" }),
    );
  });
});
