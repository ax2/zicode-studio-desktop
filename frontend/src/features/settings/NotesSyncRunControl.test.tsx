import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { NotesSyncRunControl } from "./NotesSyncRunControl";
import { NotesSyncTab } from "./NotesSyncTab";
import { notesSyncMessage, notesSyncMessages, parseNotesSyncRunStatus } from "./notes-sync-task-state";

const connection = { endpoint: "https://fixture.invalid/dav/", username: "synthetic-user", vaultId: "synthetic-library" };
const idle = { runId: null, running: false, state: "idle", conflictCount: 0, retryAfterSeconds: null };
const running = { ...idle, runId: "run-one", running: true, state: "running" };
const base = { workspaceId: "workspace-one", revision: "saved-revision", connection, ready: true, getSceneId: () => "programming" };
type Args = { request: Record<string, unknown> };
const deferred = () => { let resolve!: (value: unknown) => void; const promise = new Promise(resolvePromise => { resolve = resolvePromise; }); return { promise, resolve }; };
beforeEach(() => { setLocale("en"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("requires destination review and explicit confirmation; sends only saved revision and scope", async () => {
  const invoke = vi.fn(async (_command: string, args: Args) => args.request.kind === "start" ? running : idle);
  const view = render(<NotesSyncRunControl {...base} invoke={invoke} />);
  await view.findByText(notesSyncMessages.idle);
  fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  expect(invoke).toHaveBeenCalledOnce();
  expect(view.getByText(connection.endpoint)).toBeTruthy(); expect(view.getByText(connection.username)).toBeTruthy();
  expect(view.getByText(connection.vaultId)).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Confirm and sync" }));
  await view.findByText(notesSyncMessages.running);
  expect(invoke).toHaveBeenLastCalledWith("notes_sync_task", { request: { kind: "start", workspaceId: base.workspaceId, sceneId: "programming", revision: "saved-revision", confirmed: true } });
  expect(fetch).not.toHaveBeenCalled();
  view.unmount(); expect(invoke).toHaveBeenCalledTimes(2);
});

it("cancels the restored run by exact identity and does not cancel on settings unmount", async () => {
  const invoke = vi.fn(async (_command: string, args: Args) => args.request.kind === "cancel" ? { ...idle, runId: running.runId, state: "cancelled" } : running);
  const view = render(<NotesSyncRunControl {...base} ready={false} invoke={invoke} />);
  fireEvent.click(await view.findByRole("button", { name: "Cancel sync" }));
  await view.findByText(notesSyncMessages.cancelled);
  expect(invoke).toHaveBeenLastCalledWith("notes_sync_task", { request: { kind: "cancel", workspaceId: base.workspaceId, sceneId: "programming", runId: "run-one" } });
  view.unmount(); expect(invoke).toHaveBeenCalledTimes(2);
});

it("invalidates confirmation when saved revision, destination, readiness or current scene changes", async () => {
  let scene = "programming";
  const props = { ...base, getSceneId: () => scene, invoke: vi.fn(async (_command: string, _args: Args) => idle) };
  const view = render(<NotesSyncRunControl {...props} />);
  await view.findByText(notesSyncMessages.idle);
  fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  view.rerender(<NotesSyncRunControl {...props} connection={{ ...connection, endpoint: "https://changed.invalid/" }} />);
  expect(view.queryByRole("button", { name: "Confirm and sync" })).toBeNull();
  view.rerender(<NotesSyncRunControl {...props} revision="revision-two" />);
  await view.findByText(notesSyncMessages.idle);
  fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  view.rerender(<NotesSyncRunControl {...props} revision="revision-two" ready={false} />);
  expect(view.queryByRole("button", { name: "Confirm and sync" })).toBeNull();
  view.rerender(<NotesSyncRunControl {...props} revision="revision-two" />);
  fireEvent.click(view.getByRole("button", { name: "Sync now" })); scene = "another-scene";
  fireEvent.click(view.getByRole("button", { name: "Confirm and sync" }));
  await waitFor(() => expect(props.invoke).toHaveBeenLastCalledWith("notes_sync_task", { request: { kind: "status", workspaceId: base.workspaceId, sceneId: "another-scene" } }));
  expect(props.invoke.mock.calls.every(call => call[1].request.kind === "status")).toBe(true);
});

it("polls one request at a time while running and stops after terminal state", async () => {
  vi.useFakeTimers(); const poll = deferred();
  const invoke = vi.fn().mockResolvedValueOnce(running).mockReturnValueOnce(poll.promise);
  const view = render(<NotesSyncRunControl {...base} invoke={invoke} />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(invoke).toHaveBeenCalledTimes(2);
  await act(async () => { poll.resolve({ ...idle, runId: "run-one", state: "synced" }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(invoke).toHaveBeenCalledTimes(2); expect(view.getByText(notesSyncMessages.synced)).toBeTruthy();
});

it("a delayed running poll cannot overwrite a completed cancellation", async () => {
  vi.useFakeTimers(); const poll = deferred();
  const invoke = vi.fn().mockResolvedValueOnce(running).mockReturnValueOnce(poll.promise).mockResolvedValueOnce({ ...idle, runId: "run-one", state: "cancelled" });
  const view = render(<NotesSyncRunControl {...base} invoke={invoke} />);
  await act(async () => {}); await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  fireEvent.click(view.getByRole("button", { name: "Cancel sync" })); await act(async () => {});
  await act(async () => { poll.resolve(running); });
  expect(view.getByText(notesSyncMessages.cancelled)).toBeTruthy();
  expect(view.queryByRole("button", { name: "Cancel sync" })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); expect(invoke).toHaveBeenCalledTimes(3);
});

it("stops polling on read failure and recovers only by manual refresh without exposing raw errors", async () => {
  vi.useFakeTimers();
  const invoke = vi.fn().mockResolvedValueOnce(running).mockRejectedValueOnce(Error("do-not-render-secret")).mockResolvedValueOnce({ ...idle, state: "network" });
  const view = render(<NotesSyncRunControl {...base} invoke={invoke} />);
  await act(async () => {}); await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(view.getByRole("alert").textContent).toBe("Could not read sync status. Refresh sync status to try again.");
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); }); expect(invoke).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).not.toContain("do-not-render-secret");
  fireEvent.click(view.getByRole("button", { name: "Refresh sync status" })); await act(async () => {});
  expect(view.getByText(notesSyncMessages.network)).toBeTruthy(); expect(invoke).toHaveBeenCalledTimes(3);
});

it("ignores a previous scope's late status and blocks an unrendered workspace switch", async () => {
  const old = deferred(); let workspace = base.workspaceId;
  const invoke = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(idle);
  const props = { ...base, invoke, getWorkspaceId: () => workspace };
  const view = render(<NotesSyncRunControl {...props} />);
  workspace = "workspace-two"; view.rerender(<NotesSyncRunControl {...props} workspaceId={workspace} />);
  await view.findByText(notesSyncMessages.idle); await act(async () => { old.resolve(running); });
  expect(view.queryByRole("button", { name: "Cancel sync" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Sync now" })); workspace = "workspace-three";
  fireEvent.click(view.getByRole("button", { name: "Confirm and sync" }));
  expect(view.getByRole("alert").textContent).toContain("Workspace or scene changed"); expect(invoke).toHaveBeenCalledTimes(2);
});

it.each(["authentication", "network", "rateLimited", "settingsChanged", "localChanged", "conflicts", "remoteReset", "unsupportedServer", "invalidKey", "tooLarge"])("shows the actual %s result without claiming success", async state => {
  const invoke = vi.fn().mockResolvedValue({ ...idle, runId: "run-one", state, retryAfterSeconds: state === "rateLimited" ? 42 : null, conflictCount: state === "conflicts" ? 3 : 0 });
  const view = render(<NotesSyncRunControl {...base} invoke={invoke} />);
  await view.findByText(notesSyncMessages[state]);
  expect(view.queryByText(notesSyncMessages.synced)).toBeNull(); expect(view.getByText("Last sync result")).toBeTruthy();
  if (state === "rateLimited") expect(view.getByText(/42 seconds/)).toBeTruthy();
  if (state === "conflicts") expect(view.getByText("Conflicting records: 3")).toBeTruthy();
});

it("localizes confirmation and network results", async () => {
  setLocale("zh-CN");
  const invoke = vi.fn().mockResolvedValue({ ...idle, state: "network" });
  const view = render(<NotesSyncRunControl {...base} invoke={invoke} />);
  await view.findByText("无法连接云端，已保存的笔记和待同步任务均已保留。");
  fireEvent.click(view.getByRole("button", { name: "立即同步" }));
  expect(view.getByRole("button", { name: "确认并同步" })).toBeTruthy();
});

it("wires the real settings component to task status and explicit start, disabling draft settings", async () => {
  const settings = { revision: "saved-revision", connection, credentialStorage: "system", passwordConfigured: true, keyConfigured: true, state: "configured", syncAvailable: true };
  const invoke = vi.fn(async (command: string, args: Args) => command === "notes_sync_settings" ? settings : args.request.kind === "start" ? { ...idle, state: "synced", runId: "run-one" } : idle);
  const view = render(<NotesSyncTab getWorkspaceId={() => base.workspaceId} getSceneId={base.getSceneId} invoke={invoke} />);
  await view.findByText(notesSyncMessages.idle);
  fireEvent.change(view.getByLabelText("WebDAV address"), { target: { value: "https://unsaved.invalid/" } });
  expect((view.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(view.getByLabelText("WebDAV address"), { target: { value: connection.endpoint } });
  fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  fireEvent.click(view.getByRole("button", { name: "Confirm and sync" }));
  await view.findByText(notesSyncMessages.synced);
  expect(invoke).toHaveBeenLastCalledWith("notes_sync_task", { request: { kind: "start", workspaceId: base.workspaceId, sceneId: "programming", revision: "saved-revision", confirmed: true } });
  expect(view.queryByText(/task is not connected yet|Sync has not started/)).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});

it("rejects malformed Host results and safely handles unknown state names", async () => {
  for (const value of [null, {}, { ...idle, running: true }, { ...idle, conflictCount: -1 }, { ...idle, retryAfterSeconds: 0.5 }]) expect(() => parseNotesSyncRunStatus(value)).toThrow();
  expect(notesSyncMessage("toString")).toBe(notesSyncMessages.failed);
  const invoke = vi.fn().mockResolvedValue({ ...idle, running: true });
  const view = render(<NotesSyncRunControl {...base} invoke={invoke} />);
  await view.findByRole("alert"); expect((view.getByRole("button", { name: "Sync now" }) as HTMLButtonElement).disabled).toBe(true);
});


it("does not fall back to a stale workspace when the current workspace disappears", async () => {
  let workspace: string | undefined = base.workspaceId;
  const invoke = vi.fn(async (_command: string, _args: Args) => idle);
  const view = render(<NotesSyncRunControl {...base} getWorkspaceId={() => workspace} invoke={invoke} />);
  await view.findByText(notesSyncMessages.idle);
  fireEvent.click(view.getByRole("button", { name: "Sync now" })); workspace = undefined;
  fireEvent.click(view.getByRole("button", { name: "Confirm and sync" }));
  await view.findByRole("alert"); expect(invoke).toHaveBeenCalledOnce();
});

it("emits the shared production Rust request contract and reads its exact response shapes", async () => {
  const contract = JSON.parse(readFileSync(resolve("tests/fixtures/notes-sync-task/contract.json"), "utf8"));
  const requests = contract.requests as Record<string, Record<string, unknown>>;
  const responses = contract.responses as Record<string, unknown>;
  expect(contract.schemaVersion).toBe(1);
  for (const response of Object.values(responses)) expect(parseNotesSyncRunStatus(response)).toEqual(response);
  const invoke = vi.fn(async (_command: string, args: Args) => responses[args.request.kind === "status" ? "idle" : args.request.kind === "start" ? "running" : "cancelled"]);
  const view = render(<NotesSyncRunControl {...base} workspaceId={requests.status.workspaceId as string} revision={requests.start.revision as string} invoke={invoke} />);
  await view.findByText(notesSyncMessages.idle);
  fireEvent.click(view.getByRole("button", { name: "Sync now" }));
  fireEvent.click(view.getByRole("button", { name: "Confirm and sync" }));
  fireEvent.click(await view.findByRole("button", { name: "Cancel sync" }));
  await view.findByText(notesSyncMessages.cancelled);
  expect(invoke.mock.calls).toEqual(["status", "start", "cancel"].map(kind => ["notes_sync_task", { request: requests[kind] }]));
});
