import { expect, it } from "vitest";
import { HostControlGateway } from "./control-gateway.js";
import { createInMemoryRuntimeAdapter } from "./runtime-gateway.js";

it("scopes tool-path reads and saves and does not allow settings to override routing", async () => {
  const adapter = createInMemoryRuntimeAdapter();
  const gateway = new HostControlGateway(adapter);
  for (const settings of [
    undefined,
    { revision: 2, directories: ["/tools"], workspaceId: "wrong", operation: "delete_workspace" },
  ]) {
    const result = gateway.projectEnvironment("project", settings);
    const frame = adapter.takeSent();
    expect(frame).toMatchObject({
      type: "host_request",
      workspaceId: "project",
      operation: settings ? "project_environment_save" : "project_environment_get",
    });
    if (settings) expect(frame.directories).toEqual(["/tools"]);
    adapter.receive({
      type: "host_response",
      requestId: frame.requestId,
      settings: { revision: 3, directories: [] },
    });
    await expect(result).resolves.toMatchObject({ settings: { revision: 3 } });
  }
});
