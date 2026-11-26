import { describe, expect, it } from "vitest";
import { buildDragGhost, dropTargetIdAt } from "./NoteTreeItem";

describe("note row drag", () => {
  it("builds a drag ghost with the note title and icon", () => {
    const ghost = buildDragGhost({
      id: "n1",
      notebookId: "book-1",
      title: "Roadmap",
      icon: "🚀",
      updatedAt: "2026-07-31T08:00:00Z",
    });
    expect(ghost.className).toBe("notes-drag-ghost");
    expect(ghost.querySelector(".notes-note-icon")?.textContent).toBe("🚀");
    expect(ghost.querySelector("strong")?.textContent).toBe("Roadmap");
  });

  it("resolves the notebook id under the pointer for a drop target", () => {
    const branch = document.createElement("details");
    branch.className = "notes-notebook-branch";
    branch.dataset.notebookId = "book-2";
    const original = document.elementFromPoint;
    document.elementFromPoint = () => branch;
    try {
      expect(dropTargetIdAt(120, 340)).toBe("book-2");
    } finally {
      document.elementFromPoint = original;
    }
  });
});
