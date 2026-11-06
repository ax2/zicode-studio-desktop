import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { NotesContent } from "./NotesApp";
import type { NoteDraft } from "./draft-repository";
import { createNotesStore, type NotesGatewayLike } from "./notesStore";

const note = {
  id: "layout-note", notebookId: "layout-book", title: "Layout test",
  content: "Original", tags: [], version: 1,
};
const stores: ReturnType<typeof createNotesStore>[] = [];
afterEach(() => {
  cleanup();
  for (const store of stores.splice(0)) store.getState().destroy();
});

async function editor() {
  const records: NoteDraft[] = [];
  let finishWrite: (() => void) | undefined;
  const put = vi.fn((draft: NoteDraft) => new Promise<void>((resolve) => {
    finishWrite = () => { records.push(draft); resolve(); };
  }));
  const gateway = {
    list: async () => ({ snapshot: {
      notebooks: [{ id: note.notebookId, title: "Test book" }],
      notes: [note], tags: [],
    } }),
    get: async () => ({ note }),
    knowledge: async () => ({ snapshot: { links: [] } }),
  } as unknown as NotesGatewayLike;
  const store = createNotesStore({
    gateway,
    getTarget: () => ({ sceneId: "programming", workspaceId: "layout-workspace" }),
    draftRepository: { list: async () => ({ drafts: records, unreadable: 0 }), put, remove: vi.fn(async () => {}) },
  });
  stores.push(store);
  await store.getState().load();
  await store.getState().selectNote(note);
  store.getState().setPreview(false);
  const view = render(<NotesContent store={store} />);
  await waitFor(() => expect(view.getByRole("textbox", { name: t("Note content") })).toBeTruthy());
  return { store, view, put, finish: () => finishWrite?.() };
}

it("keeps the collapsed recovery row and editor mounted across typing and recovery writes", async () => {
  const { store, view, put, finish } = await editor();
  const panel = view.getByRole("region", { name: t("Local note recovery") });
  const details = panel.querySelector("details") as HTMLDetailsElement;
  const input = view.getByRole("textbox", { name: t("Note content") });
  input.focus();
  for (const text of ["O", "Or", "Original 中文"]) {
    fireEvent.change(input, { target: { value: text } });
    store.getState().cancelAutosave();
    expect(view.getByRole("region", { name: t("Local note recovery") })).toBe(panel);
    expect(view.getByRole("textbox", { name: t("Note content") })).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(details.open).toBe(false);
    const pending = panel.querySelector('[role="status"]');
    expect(pending).toBeTruthy();
    expect(details.contains(pending)).toBe(true);
  }
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  await act(async () => { finish(); });
  await waitFor(() => expect(store.getState().recoveryPending).toBe(false));
  expect(view.getByRole("region", { name: t("Local note recovery") })).toBe(panel);
  expect(panel.querySelector('[role="status"]')).toBeNull();
  expect(details.open).toBe(false);
  expect((input as HTMLTextAreaElement).value).toBe("Original 中文");
  await act(async () => { store.setState({ recoveryDrafts: [], dirty: false, saveState: "saved" }); });
  expect(view.getByRole("region", { name: t("Local note recovery") })).toBe(panel);
  expect(view.getByRole("textbox", { name: t("Note content") })).toBe(input);
});

it("shows incoming report as a separate preview and never offers existing-note recovery", async () => {
  const { store, view } = await editor();
  const draft: NoteDraft = {
    incoming: true, id: "incoming", revision: "r1", scope: JSON.stringify(["programming", "layout-workspace"]),
    updatedAt: new Date().toISOString(), title: "Report", icon: "📝", content: "report content", tags: [],
    note: { id: "incoming", notebookId: "", title: "Report", content: "", tags: [] },
  };
  await act(async () => { store.setState({ recoveryDrafts: [draft] }); });
  const panel = view.getByRole("region", { name: t("Local note recovery") });
  fireEvent.click(panel.querySelector("summary") as HTMLElement);
  const article = within(panel).getByText("Report").closest("article") as HTMLElement;
  expect((within(article).getByRole("textbox", { name: t("Note content") }) as HTMLTextAreaElement).value).toBe("report content");
  expect(within(article).queryByRole("button", { name: t("Open recovered draft") })).toBeNull();
  expect(within(article).getByRole("button", { name: t("Save draft as new note") })).toBeTruthy();
  expect(view.getAllByRole("textbox", { name: t("Note content") })).toHaveLength(2);
});

it("still exposes pending writes when expanded and storage errors when collapsed", async () => {
  const { store, view, finish, put } = await editor();
  fireEvent.change(view.getByRole("textbox", { name: t("Note content") }), { target: { value: "Retain me" } });
  store.getState().cancelAutosave();
  const panel = view.getByRole("region", { name: t("Local note recovery") });
  const details = panel.querySelector("details") as HTMLDetailsElement;
  fireEvent.click(details.querySelector("summary") as HTMLElement);
  expect(details.open).toBe(true);
  expect(within(panel).getByRole("status").textContent).toContain(t("Local recovery copy is pending. Keep this window open until it finishes."));
  await act(async () => { store.setState({ recoveryError: "Storage unavailable: keep this draft" }); });
  details.open = false;
  expect(view.getByRole("alert").textContent).toContain("Storage unavailable");
  expect(details.contains(view.getByRole("alert"))).toBe(false);
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  await act(async () => { finish(); });
});

it("reserves relationship message nodes through dirty, loading and saved states", async () => {
  const { store, view } = await editor();
  const row = view.container.querySelector(".notes-relationship-status") as HTMLElement;
  const [dirty, loading] = Array.from(row.children);
  expect(dirty.getAttribute("aria-hidden")).toBe("true");
  await act(async () => { store.setState({ dirty: true, relationshipLoading: false }); });
  expect(dirty.getAttribute("data-active")).toBe("true");
  await act(async () => { store.setState({ dirty: false, relationshipLoading: true }); });
  expect(dirty.getAttribute("aria-hidden")).toBe("true");
  expect(loading.getAttribute("aria-hidden")).toBe("false");
  await act(async () => { store.setState({ relationshipLoading: false }); });
  expect(loading.getAttribute("aria-hidden")).toBe("true");
  expect(Array.from(row.children)).toEqual([dirty, loading]);
  expect(view.container.querySelector(".notes-relationship-status")).toBe(row);
});

it("gives edit, preview and save icons the shared visible-size wrapper", async () => {
  const { view } = await editor();
  for (const selector of [".notes-edit-tab", ".notes-preview-tab", ".notes-save"]) {
    expect(view.container.querySelector(`${selector} > .notes-btn-icon > svg`)).toBeTruthy();
  }
});
