import { describe, expect, it, vi } from "vitest";
import { NotesGateway } from "./notes-gateway.js";

describe("NotesGateway", () => {
  it("builds bounded list filters for the active scene", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ snapshot: { notebooks: [], notes: [], tags: [] } }),
    }));
    const gateway = new NotesGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    await gateway.list("programming", "workspace-1", {
      notebookId: "book-1",
      query: "roadmap",
      sourceOnly: true,
    });
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:57620/v2/notes?sceneId=programming&workspaceId=workspace-1&notebookId=book-1&query=roadmap&sourceOnly=true",
    );
  });

  it("loads the scene-scoped knowledge graph", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ snapshot: {} }) }));
    const gateway = new NotesGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    await gateway.knowledge("programming", "workspace-1");
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:57620/v2/notes/knowledge?sceneId=programming&workspaceId=workspace-1",
    );
  });

  it("loads paged note changes for incremental synchronization", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ snapshot: {} }) }));
    const gateway = new NotesGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    await gateway.changes("programming", "workspace-1", { cursor: "cursor-1", limit: 25 });
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:57620/v2/notes/changes?sceneId=programming&workspaceId=workspace-1&limit=25&cursor=cursor-1",
    );
  });

  it("sends optimistic versions when saving and deleting", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ note: {} }) }));
    const gateway = new NotesGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    const note = {
      id: "note-1",
      notebookId: "book-1",
      title: "Roadmap",
      content: "Body",
      tags: ["plugin"],
      version: "sha256:version",
    };
    await gateway.save("programming", "workspace-1", note);
    await gateway.delete("programming", "workspace-1", note);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).expectedVersion).toBe("sha256:version");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).expectedVersion).toBe("sha256:version");
  });

  it("builds secure attachment, backup, import, and rebuild requests", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new NotesGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    const note = { id: "note-1", notebookId: "book-1" };

    await gateway.uploadAttachment("programming", "workspace-1", note, {
      fileName: "proof.txt",
      mimeType: "text/plain",
      dataBase64: "aGVsbG8=",
    });
    await gateway.exportBackup("programming", "workspace-1", "book-1");
    await gateway.importBackup("programming", "workspace-1", { schemaVersion: 1 });
    await gateway.rebuild("programming", "workspace-1", "book-1");

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      sceneId: "programming",
      notebookId: "book-1",
      noteId: "note-1",
      fileName: "proof.txt",
    });
    expect(fetchImpl.mock.calls[1][0].toString()).toContain(
      "/v2/notes/export?sceneId=programming&workspaceId=workspace-1&notebookId=book-1",
    );
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).backup.schemaVersion).toBe(1);
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body).notebookId).toBe("book-1");
    expect(gateway.attachmentUrl("programming", "workspace-1", note, "asset.txt")).toContain(
      "attachmentId=asset.txt",
    );
  });
});
