import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { NotesSyncTab } from "./NotesSyncTab";

const recoveryCode = `ZNS1-${"A".repeat(43)}`;
const connection = { endpoint: "https://fixture.invalid/dav/", username: "synthetic", vaultId: "a36d8128-2a5b-4e44-a242-e2f093610eda" };
const empty = { revision: null, connection: { ...connection, endpoint: "", username: "" }, credentialStorage: "system", passwordConfigured: false, keyConfigured: false, state: "unconfigured", syncAvailable: false };
const configured = { ...empty, revision: "revision-a", connection, passwordConfigured: true, keyConfigured: true, state: "configured" };
const workspace = () => "workspace-a";
beforeEach(() => { setLocale("en"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("saves explicit configuration and credentials without note, network or localStorage writes", async () => {
  const storageWrite = vi.spyOn(Storage.prototype, "setItem");
  const invoke = vi.fn(async (_command, args) => args.request.kind === "status" ? empty : configured);
  const view = render(<NotesSyncTab getWorkspaceId={workspace} invoke={invoke} />);
  await view.findByText("Cloud sync is not configured.");
  fireEvent.change(view.getByLabelText("WebDAV address"), { target: { value: connection.endpoint } });
  fireEvent.change(view.getByLabelText("WebDAV username"), { target: { value: connection.username } });
  fireEvent.change(view.getByLabelText("Cloud password"), { target: { value: "synthetic-password" } });
  fireEvent.change(view.getByLabelText("Recovery code"), { target: { value: recoveryCode } });
  expect(view.queryByText("Cloud sync settings have unsaved changes.")).not.toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Save cloud sync settings" }));
  await view.findByText("Configuration and credentials are saved. Sync has not started.");
  expect(view.queryByText("Cloud sync settings have unsaved changes.")).toBeNull();
  expect(invoke.mock.calls).toEqual([
    ["notes_sync_settings", { request: { kind: "status", workspaceId: "workspace-a" } }],
    ["notes_sync_settings", { request: { kind: "save", workspaceId: "workspace-a", settings: { expectedRevision: null, connection, password: "synthetic-password", recoveryCode } } }],
  ]);
  expect((view.getByLabelText("Cloud password") as HTMLInputElement).value).toBe("");
  expect((view.getByLabelText("Recovery code") as HTMLInputElement).value).toBe("");
  expect(storageWrite).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it("generates only on explicit request and keeps a new recovery code masked until revealed", async () => {
  const invoke = vi.fn(async (_command, args) => args.request.kind === "status" ? empty : { recoveryCode });
  const view = render(<NotesSyncTab getWorkspaceId={workspace} invoke={invoke} />);
  await view.findByText("Cloud sync is not configured."); expect(invoke).toHaveBeenCalledOnce();
  fireEvent.click(view.getByRole("button", { name: "Create recovery code" }));
  const input = view.getByLabelText("Recovery code") as HTMLInputElement;
  await waitFor(() => expect(input.value).toBe(recoveryCode));
  expect(input.type).toBe("password");
  fireEvent.click(view.getByLabelText("Show recovery code")); expect(input.type).toBe("text");
  expect(invoke).toHaveBeenLastCalledWith("notes_sync_settings", { request: { kind: "newRecoveryCode", workspaceId: "workspace-a" } });
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps stored secrets absent from the form and sends blank values as preserve intent", async () => {
  const invoke = vi.fn(async (_command: string, _args: unknown) => configured);
  const view = render(<NotesSyncTab getWorkspaceId={workspace} invoke={invoke} />);
  await view.findByText("Configuration and credentials are saved. Sync has not started.");
  expect((view.getByLabelText("Cloud password") as HTMLInputElement).value).toBe("");
  expect((view.getByRole("button", { name: "Create recovery code" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Save cloud sync settings" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  expect(invoke.mock.calls[1][1]).toEqual({ request: { kind: "save", workspaceId: "workspace-a", settings: { expectedRevision: "revision-a", connection, password: null, recoveryCode: null } } });
});

it("reports disabled system credentials and cannot save or generate even with a synthetic submit", async () => {
  const invoke = vi.fn(async () => ({ ...empty, credentialStorage: "disabled", state: "credentialStorageDisabled" }));
  const view = render(<NotesSyncTab getWorkspaceId={workspace} invoke={invoke} />);
  await view.findByText("System credentials are disabled in this isolated profile.");
  expect(view.container.querySelector("fieldset")?.disabled).toBe(true);
  fireEvent.submit(view.container.querySelector("form") as HTMLFormElement);
  fireEvent.click(view.getByRole("button", { name: "Create recovery code" }));
  expect(invoke).toHaveBeenCalledOnce();
});

it("shows actual unavailable or incomplete readiness without inventing runtime sync states", async () => {
  const invoke = vi.fn().mockResolvedValueOnce({ ...configured, state: "credentialsUnavailable" }).mockResolvedValueOnce({ ...empty, connection, state: "credentialsMissing" });
  const view = render(<NotesSyncTab getWorkspaceId={workspace} invoke={invoke} />);
  await view.findByText("System credential storage is unavailable. Your saved configuration is kept.");
  expect(view.queryByText(/Cloud password is missing/)).toBeNull();
  expect(view.queryByText(/Recovery key is missing/)).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Refresh" }));
  await view.findByText("Configuration saved. Add the cloud password and recovery code to complete setup.");
  expect(view.queryByRole("button", { name: /sync now|pause/i })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("discards the old workspace's late save response and clears secret inputs before refreshing the new scope", async () => {
  let workspaceId = "workspace-a", finish!: (value: unknown) => void;
  const getWorkspaceId = () => workspaceId;
  const invoke = vi.fn(async (_command, args) => {
    if (args.request.kind === "save") return new Promise(resolve => { finish = resolve; });
    return args.request.workspaceId === "workspace-a" ? configured : { ...empty, connection: { ...connection, username: "workspace-b" } };
  });
  const view = render(<NotesSyncTab getWorkspaceId={getWorkspaceId} invoke={invoke} />);
  await view.findByText("Configuration and credentials are saved. Sync has not started.");
  fireEvent.change(view.getByLabelText("Cloud password"), { target: { value: "pending-secret" } });
  fireEvent.click(view.getByRole("button", { name: "Save cloud sync settings" }));
  await waitFor(() => expect(finish).toBeTypeOf("function")); workspaceId = "workspace-b";
  await act(async () => { finish(configured); });
  await waitFor(() => expect((view.getByLabelText("WebDAV username") as HTMLInputElement).value).toBe("workspace-b"));
  expect((view.getByLabelText("Cloud password") as HTMLInputElement).value).toBe("");
  expect(invoke).toHaveBeenLastCalledWith("notes_sync_settings", { request: { kind: "status", workspaceId: "workspace-b" } });
});

it("uses safe localized errors instead of echoing backend text or typed secrets", async () => {
  setLocale("zh-CN");
  const invoke = vi.fn().mockResolvedValueOnce(empty).mockRejectedValueOnce(Error("synthetic-secret-must-not-render"));
  const view = render(<NotesSyncTab getWorkspaceId={workspace} invoke={invoke} />);
  await view.findByText("尚未配置笔记云同步。");
  fireEvent.click(view.getByRole("button", { name: "保存同步配置" }));
  expect((await view.findByRole("alert")).textContent).toBe("无法读取或保存笔记云同步设置。");
  expect(document.body.textContent).not.toContain("synthetic-secret-must-not-render");
});

it("does not call an unreadable saved configuration unconfigured", async () => {
  const invoke = vi.fn().mockRejectedValue("notes_sync_settings_invalid");
  const view = render(<NotesSyncTab getWorkspaceId={workspace} invoke={invoke} />);
  await view.findByText("Cloud sync settings could not be read safely. The saved files are kept.");
  expect(view.getByRole("status").textContent).toBe("Cloud sync status is unavailable.");
  expect(view.queryByText("Cloud sync is not configured.")).toBeNull();
});
