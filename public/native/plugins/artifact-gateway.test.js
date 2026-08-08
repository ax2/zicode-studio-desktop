import { describe, expect, it, vi } from "vitest";
import { ArtifactGateway } from "./artifact-gateway.js";

describe("ArtifactGateway", () => {
  it("builds scene-scoped list and item requests", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new ArtifactGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });

    await gateway.list("finance", "workspace-1", {
      kind: "report",
      pluginId: "com.zicode.finance",
      query: "backtest",
    });
    await gateway.get("finance", "workspace-1", "artifact-1");

    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:57620/v2/artifacts?sceneId=finance&workspaceId=workspace-1&kind=report&pluginId=com.zicode.finance&query=backtest",
    );
    expect(fetchImpl.mock.calls[1][0].toString()).toContain(
      "/v2/artifacts/item?sceneId=finance&workspaceId=workspace-1&artifactId=artifact-1",
    );
  });

  it("creates bounded documents and sends optimistic versions on delete", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new ArtifactGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    const artifact = {
      id: "artifact-1",
      pluginId: "com.zicode.finance",
      kind: "report",
      title: "Backtest",
      version: "sha256:version",
      provenance: { engine: "local" },
      content: { metrics: {} },
    };

    await gateway.create("finance", "workspace-1", artifact);
    await gateway.delete("finance", "workspace-1", artifact);

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      sceneId: "finance",
      workspaceId: "workspace-1",
      pluginId: "com.zicode.finance",
      kind: "report",
      mimeType: "application/json",
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      sceneId: "finance",
      workspaceId: "workspace-1",
      artifactId: "artifact-1",
      expectedVersion: "sha256:version",
    });
  });
});
