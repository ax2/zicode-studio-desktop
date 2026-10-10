import { expect, it } from "vitest";
import { HostDataGateway } from "./data-gateway.js";
import { createInMemoryRuntimeAdapter } from "./runtime-gateway.js";

it("requests recent history without a cursor and forwards an anchored cursor for older pages", async () => {
  const adapter = createInMemoryRuntimeAdapter();
  const gateway = new HostDataGateway(adapter);
  for (const cursor of [undefined, { head: "a".repeat(40), offset: 50 }]) {
    const request = gateway.workspaceGitHistory("project", cursor);
    const frame = adapter.takeSent();
    expect(frame).toMatchObject({ operation: "workspace_git_history", workspaceId: "project" });
    expect(frame.cursor).toEqual(cursor);
    const history = { head: "a".repeat(40), commits: [], hasMore: false, nextCursor: null };
    adapter.receive({ type: "data_response", requestId: frame.requestId, operation: "workspace_git_history", history });
    await expect(request).resolves.toMatchObject({ history });
  }
});
