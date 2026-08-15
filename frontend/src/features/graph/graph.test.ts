import { describe, expect, it } from "vitest";
import { buildGraph, layoutGraph, noteKey, pairTitles } from "./graphLogic";

describe("graph logic", () => {
  it("collapses identical pair titles instead of showing a self-arrow", () => {
    expect(pairTitles("Example Domain", "Example Domain")).toBe("Example Domain ×2");
    expect(pairTitles("Example Domain", " example domain ")).toBe("Example Domain ×2");
    expect(pairTitles("Alpha", "Beta")).toBe("Alpha ↔ Beta");
  });

  it("builds a deduplicated graph from links and similar pairs", () => {
    const { nodes, edges } = buildGraph({
      links: [
        {
          fromNotebookId: "nb1",
          fromNoteId: "a",
          fromTitle: "Alpha",
          toNotebookId: "nb1",
          toNoteId: "b",
          toTitle: "Beta",
          kind: "backlink",
        },
      ],
      similar: [
        {
          leftNotebookId: "nb1",
          leftNoteId: "a",
          leftTitle: "Alpha",
          rightNotebookId: "nb2",
          rightNoteId: "c",
          rightTitle: "Gamma",
          score: 0.8,
          sharedTags: ["roadmap"],
        },
      ],
      conflicts: [],
    });
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);
    expect(edges[1].kind).toBe("similar");
  });

  it("lays out every node within the canvas bounds", () => {
    const nodes = [
      { id: noteKey("nb1", "a"), notebookId: "nb1", noteId: "a", title: "A", group: "nb1" },
      { id: noteKey("nb1", "b"), notebookId: "nb1", noteId: "b", title: "B", group: "nb1" },
      { id: noteKey("nb2", "c"), notebookId: "nb2", noteId: "c", title: "C", group: "nb2" },
    ];
    const edges = [
      { source: noteKey("nb1", "a"), target: noteKey("nb1", "b"), kind: "link" },
      { source: noteKey("nb1", "a"), target: noteKey("nb2", "c"), kind: "similar" },
    ];
    const positions = layoutGraph(nodes, edges);
    for (const node of nodes) {
      const point = positions.get(node.id);
      expect(point).toBeDefined();
      expect(point?.x).toBeGreaterThanOrEqual(0);
      expect(point?.x).toBeLessThanOrEqual(900);
      expect(point?.y).toBeGreaterThanOrEqual(0);
      expect(point?.y).toBeLessThanOrEqual(560);
    }
  });

  it("centers a single node", () => {
    const positions = layoutGraph([
      { id: "x", notebookId: "nb1", noteId: "a", title: "A", group: "nb1" },
    ], []);
    expect(positions.get("x")).toEqual({ x: 450, y: 280 });
  });
});
