import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ArchivedSuggestion, NovelModelHistory } from "./NovelModelHistory";
import { NovelModelPlan } from "./NovelModelPlan";
import type { CharacterRequest } from "./useCharacterRecords";

vi.mock("../../shared/i18n", () => ({ t: (value: string) => value }));
afterEach(cleanup);
const evidence = {
  workspaceId: "fixture",
  notebookId: "book",
  chapterId: "chapter",
  chapterTitle: "The bridge",
  revision: "revision-one",
  line: 2,
  quote: "A blue coat.",
};
const choice = {
  provider: "fixture",
  model: "local",
  name: "Fixture",
  endpoint: "http://localhost",
};
const plan = {
  model: choice,
  evidence,
  prompt: "Complete fictional request",
  digest: "digest",
  promptBytes: 23,
  maxPromptBytes: 32768,
  maxOutputTokens: 2048,
  timeoutSeconds: 120,
};
it("requires selection and one explicit send for the reviewed plan", async () => {
  const request = vi.fn<CharacterRequest>(async (action) =>
    action.kind === "modelCatalog"
      ? { models: [choice] }
      : action.kind === "modelPreview"
        ? plan
        : {},
  );
  render(
    <NovelModelPlan
      request={request}
      characterId="role"
      facet="identity"
      baseVersion={1}
      evidence={evidence}
      disabled={false}
    />,
  );
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Choose a model" }));
  fireEvent.change(await screen.findByRole("combobox"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Review the complete model request" }));
  expect(await screen.findByText(plan.prompt)).toBeTruthy();
  expect(request.mock.calls.map(([action]) => action.kind)).toEqual([
    "modelCatalog",
    "modelPreview",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Authorize and send this request once" }));
  await screen.findByText(/Request submitted/);
  expect(request).toHaveBeenLastCalledWith({
    kind: "modelJob",
    action: {
      kind: "submit",
      id: expect.any(String),
      digest: "digest",
      confirmed: true,
      input: {
        characterId: "role",
        facet: "identity",
        baseVersion: 1,
        evidence,
        provider: "fixture",
        model: "local",
      },
    },
  });
  expect(screen.queryByRole("button", { name: "Authorize and send this request once" })).toBeNull();
});

it("recovers a finished job, preserves its suggestion, and reports a changed base without approving", async () => {
  const onSaved = vi.fn();
  const kinds: string[] = [];
  let conflict = true;
  const request = vi.fn<CharacterRequest>(async (req) => {
    const action = req.action as { kind: string; selection?: { text: string } };
    kinds.push(action.kind);
    if (action.kind === "history")
      return {
        entries: [
          { id: "job", plan, state: "ready", result: { text: "Blue coat" }, archivedDraftId: null },
        ],
        next: null,
      };
    expect(action.selection).toMatchObject({ text: "Blue linen coat", jobId: "job" });
    if (conflict) throw new Error("visual_assets_character_revision_changed");
    return { id: "draft" };
  });
  render(
    <NovelModelHistory request={request} characterId="role" onSaved={onSaved} disabled={false} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Saved model tasks" }));
  fireEvent.click(await screen.findByText(/The bridge · local/));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Blue linen coat" } });
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed text as a draft" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Blue coat")).toBeTruthy();
  expect(onSaved).not.toHaveBeenCalled();
  conflict = false;
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed text as a draft" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(kinds).toEqual(["history", "adopt", "adopt", "history"]);
});

it("reads archived evidence without a model job or chapter access", async () => {
  const request = vi.fn<CharacterRequest>(async () => ({
    source: { plan, result: { text: "Archived original" } },
  }));
  render(<ArchivedSuggestion id="restored" request={request} disabled={false} />);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View archived model source" }));
  await screen.findByText("Archived original");
  expect(request.mock.calls).toEqual([[{ kind: "modelSource", id: "restored" }]]);
});

it("only offers cancellation for a task active in this Studio process and never resends it", async () => {
  const kinds: string[] = [];
  const request = vi.fn<CharacterRequest>(async (req) => {
    const action = req.action as { kind: string };
    kinds.push(action.kind);
    if (action.kind === "history")
      return {
        entries: [{ id: "job", plan, state: "unknown", result: null, archivedDraftId: null }],
        next: null,
      };
    if (action.kind === "status") return { active: true, job: { state: "unknown" } };
    return { cancelRequested: true };
  });
  render(
    <NovelModelHistory characterId="role" request={request} onSaved={vi.fn()} disabled={false} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Saved model tasks" }));
  fireEvent.click(await screen.findByText(/The bridge · local/));
  expect(screen.queryByRole("button", { name: "Cancel active request" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check request status" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel active request" }));
  await screen.findByText(/Cancellation requested/);
  expect(kinds).toEqual(["history", "status", "cancel"]);
});
