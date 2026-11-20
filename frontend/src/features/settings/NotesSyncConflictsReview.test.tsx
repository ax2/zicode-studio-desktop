import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { NotesSyncConflictsReview } from "./NotesSyncConflictsReview";

const fixture = JSON.parse(readFileSync("tests/fixtures/notes-sync-conflicts/contract.json", "utf8"));
const { workspaceId, sceneId, revision, runId } = fixture.requests.list;
afterEach(cleanup);
function setup(stale = false) {
  setLocale("en");
  const onApplied = vi.fn();
  const invoke = vi.fn(async (_: string, args: {request: Record<string, unknown>}) => {
    const value = fixture.responses[String(args.request.kind)];
    return stale ? {...value, revision: "other"} : value;
  });
  const view = render(<NotesSyncConflictsReview scope={{workspaceId,sceneId,revision,runId}} enabled current={() => true}
    invoke={invoke} libraryId="synthetic-library" onApplied={onApplied} onClose={() => {}}/>);
  return {view,invoke,onApplied};
}
it("compares both full versions and requires explicit local confirmation without starting a sync", async () => {
  const {view,invoke,onApplied} = setup();
  fireEvent.click(await view.findByRole("button", {name:"Compare versions"}));
  await view.findByText("Local synthetic body"); await view.findByText("Cloud synthetic body");
  fireEvent.change(view.getByRole("combobox"), {target:{value:"both"}});
  fireEvent.click(view.getByRole("button", {name:"Review choices"}));
  expect(invoke.mock.calls).toHaveLength(2);
  fireEvent.click(view.getByRole("button", {name:"Confirm and save locally"}));
  await waitFor(() => expect(onApplied).toHaveBeenCalledWith(fixture.responses.apply));
  expect(invoke.mock.calls).toEqual(["list","detail","apply"].map(kind => ["notes_sync_conflicts", {request:fixture.requests[kind]}]));
});
it("rejects a review captured for another configuration", async () => {
  const {view,invoke,onApplied} = setup(true);
  await view.findByRole("alert");
  expect(view.queryByRole("combobox")).toBeNull();
  expect(onApplied).not.toHaveBeenCalled();
  expect(invoke).toHaveBeenCalledTimes(1);
});
