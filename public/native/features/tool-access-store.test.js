import { expect, it, vi } from "vitest";
import { HostControlGateway } from "../transport/control-gateway.js";
import { createInMemoryRuntimeAdapter } from "../transport/runtime-gateway.js";
import { createToolAccessStore } from "./tool-access-store.js";

it("keeps routing outside caller-supplied metadata and validates saved snapshots", async () => {
  const adapter = createInMemoryRuntimeAdapter();
  const gateway = new HostControlGateway(adapter);
  const store = createToolAccessStore(gateway);
  const pending = store.read({ sceneId: "s", workspaceId: "w", operation: "delete_sessions", schemaVersion: 99 });
  const frame = adapter.takeSent();
  expect(frame).toMatchObject({ operation: "tool_access_read", schemaVersion: 1, sceneId: "s", workspaceId: "w" });
  adapter.receive({ requestId: frame.requestId, access: { schemaVersion: 1, revision: 0, favorites: [], recent: [] } });
  await expect(pending).resolves.toMatchObject({ favorites: [] });
  const invalid = createToolAccessStore({ toolAccess: vi.fn().mockResolvedValue({ access: { schemaVersion: 2 } }) });
  await expect(invalid.read({ sceneId: "s", workspaceId: "w" })).rejects.toThrow("tool_access_incompatible");
});
