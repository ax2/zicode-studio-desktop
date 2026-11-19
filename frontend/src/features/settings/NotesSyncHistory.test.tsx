import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { NotesSyncTab } from "./NotesSyncTab";

afterEach(cleanup);

it("previews the exact destination, blocks dirty edits and only restores the selected local revision on confirmation", async () => {
  setLocale("en");
  const current = { endpoint: "https://current.invalid/", username: "current", vaultId: "current-vault" };
  const target = { endpoint: "https://previous.invalid/", username: "previous", vaultId: "previous-vault" };
  const status = { connection: current, revision: "current", state: "configured", credentialStorage: "system", syncAvailable: false };
  const invoke = vi.fn().mockResolvedValueOnce(status).mockResolvedValueOnce([
    { revision: "old", connection: target, archivedAt: 1700000000000, keyRef: "must-not-render" },
  ]).mockResolvedValueOnce({ ...status, revision: "restored", connection: target });
  const view = render(<NotesSyncTab getWorkspaceId={() => "one"} invoke={invoke} />);
  fireEvent.click(await view.findByRole("button", { name: "Sync settings history" }));
  const selector = await view.findByRole("combobox");
  fireEvent.change(selector, { target: { value: "old" } });
  expect(view.getByRole("cell", { name: target.endpoint })).toBeTruthy();
  expect(view.getByRole("cell", { name: current.endpoint })).toBeTruthy();
  expect(view.container.textContent).not.toContain("must-not-render");
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(view.queryByRole("button", { name: "Confirm local restore" })).toBeNull();
  fireEvent.change(selector, { target: { value: "old" } });
  const password = view.getByLabelText("Cloud password") as HTMLInputElement;
  fireEvent.change(password, { target: { value: "draft" } });
  const confirm = view.getByRole("button", { name: "Confirm local restore" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(password.value).toBe("draft");
  expect(invoke).toHaveBeenCalledTimes(2);
  fireEvent.change(password, { target: { value: "" } });
  fireEvent.click(confirm);
  await waitFor(() => expect((view.getByLabelText("WebDAV address") as HTMLInputElement).value).toBe(target.endpoint));
  expect(invoke.mock.calls.map(([name, args]) => [name, args.request])).toEqual([
    ["notes_sync_settings", { kind: "status", workspaceId: "one" }],
    ["notes_sync_settings", { kind: "history", workspaceId: "one" }],
    ["notes_sync_settings", { kind: "restore", workspaceId: "one", expectedRevision: "current", revision: "old" }],
  ]);
});
