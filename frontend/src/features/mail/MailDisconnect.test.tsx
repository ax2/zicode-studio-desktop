import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {setLocale} from "../../shared/i18n";
import {Mail,type Invoke} from "./index";
import {MailDisconnect} from "./MailDisconnect";
afterEach(()=>{cleanup();vi.restoreAllMocks()});
it("keeps cached messages by default and requires explicit confirmation to clear them",async()=>{
  setLocale("en");
  const disconnect=vi.fn(async()=>true);
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(true);
  render(<MailDisconnect connected label="Disconnect" prompt="Keep cache?" disconnect={disconnect}/>);
  const action=screen.getByRole("button",{name:"Disconnect"});
  fireEvent.click(action);await waitFor(()=>expect(disconnect).toHaveBeenCalledWith(false));
  fireEvent.click(screen.getByRole("checkbox"));confirm.mockReturnValue(Promise.resolve(false) as unknown as boolean);
  fireEvent.click(action);await waitFor(()=>expect(confirm).toHaveBeenCalledTimes(2));
  expect(disconnect).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);fireEvent.click(action);
  await waitFor(()=>expect(disconnect).toHaveBeenCalledWith(true));
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
});

it("ignores a pending confirmation after the user leaves that account",async()=>{
  setLocale("en");let finish:(ok:boolean)=>void=()=>{};
  vi.spyOn(window,"confirm").mockImplementation(()=>new Promise<boolean>(r=>{finish=r;}) as unknown as boolean);
  const disconnect=vi.fn(async()=>true);
  const view=render(<MailDisconnect connected label="Disconnect" prompt="Keep cache?" disconnect={disconnect}/>);
  fireEvent.click(screen.getByRole("button",{name:"Disconnect"}));view.unmount();finish(true);
  await Promise.resolve();expect(disconnect).not.toHaveBeenCalled();
});

it.each([
  ["gmail", "status", { connected: true, read: true }, "disconnect", "Disconnect Gmail", "gmail_storage"],
  ["alibaba", "credentialStatus", { configured: true, enabled: true }, "forgetPassword", "Remove client password", "mail_storage"],
] as const)("preserves the %s cache choice through a failed disconnect and a confirmed retry", async (
  provider, statusKind, status, disconnectKind, actionLabel, storageError,
) => {
  setLocale("en");
  const accountId = "isolated-account";
  const subject = "Saved inbox message";
  const body = "Original cached body";
  const savedDraft = "Draft kept during disconnect";
  const gmail = provider === "gmail";
  const summary = gmail
    ? { id: "message", subject, from: "fixture@example.test", date: "", snippet: "" }
    : { uid: 1, subject, sender: "fixture@example.test", replyTo: "fixture@example.test" };
  let fail = true;
  const invoke = vi.fn(async (request: Record<string, unknown>) => {
    switch (request.kind) {
      case "accounts": return [{ id: accountId, provider, address: "fixture@example.test" }];
      case "drafts": return [{ id: "draft", subject: savedDraft, body: "Original draft", recipient: "receiver@example.test", revision: 1 }];
      case "cachedFolders":
      case "cachedLabels": return [];
      case statusKind: return status;
      case "cachedPage": return gmail
        ? { items: [summary], nextCursor: null }
        : { uidValidity: 1, messages: [summary], next: null };
      case "cachedBody": return gmail ? { ...summary, plainText: body } : { summary, text: body };
      case disconnectKind:
        if (fail) throw Error(storageError);
        return gmail ? { revoked: true } : { configured: false };
      default: throw Error("Unexpected request");
    }
  });
  render(<Mail invoke={invoke as Invoke} transport={invoke as Invoke} gmailTransport={invoke as Invoke}/>);
  const open = await screen.findByRole("button", { name: /Saved inbox message/ });
  await waitFor(() => expect(open.matches(":disabled")).toBe(false));
  fireEvent.click(open);
  await screen.findByText(body);
  const action = screen.getByRole("button", { name: actionLabel });
  const choice = screen.getByRole<HTMLInputElement>("checkbox", { name: "Clear cached messages for this account" });
  expect(choice.checked).toBe(false);
  fireEvent.click(choice);
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  fireEvent.click(action);
  await screen.findByText("Could not access local mail data.");
  const requests = () => invoke.mock.calls.map(([request]) => request).filter(request => request.kind === disconnectKind);
  expect(requests()).toEqual([{ kind: disconnectKind, accountId, clearCache: true }]);
  expect(choice.checked).toBe(true);
  expect(screen.getByText(body)).toBeTruthy();
  expect(screen.getByRole("button", { name: savedDraft })).toBeTruthy();
  const prompt = "Disconnect this account and clear its cached messages? Drafts and delivery records will be kept.";
  expect(confirm).toHaveBeenLastCalledWith(prompt);
  confirm.mockReturnValue(false);
  await act(async () => fireEvent.click(action));
  expect(requests()).toHaveLength(1);
  expect(choice.checked).toBe(true);
  expect(confirm).toHaveBeenLastCalledWith(prompt);
  fireEvent.click(choice);
  await act(async () => fireEvent.click(action));
  expect(requests()).toHaveLength(1);
  expect(choice.checked).toBe(false);
  expect(confirm.mock.lastCall?.[0]).not.toBe(prompt);
  fireEvent.click(choice);
  confirm.mockReturnValue(true);
  fail = false;
  fireEvent.click(action);
  await waitFor(() => expect(screen.queryByText(body)).toBeNull());
  expect(requests()).toEqual(Array.from({ length: 2 }, () => ({ kind: disconnectKind, accountId, clearCache: true })));
  expect(confirm).toHaveBeenLastCalledWith(prompt);
  expect(choice.checked).toBe(false);
  expect(screen.getByRole("button", { name: savedDraft })).toBeTruthy();
});

it("does not reset the new account choice on a late successful disconnect", async () => {
  setLocale("en");
  let complete = (_completed: boolean) => {};
  const first = vi.fn(() => new Promise<boolean>(resolve => { complete = resolve; }));
  const second = vi.fn(async () => true);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const view = render(<MailDisconnect key="first" connected label="Disconnect first" prompt="Keep cache?" disconnect={first}/>);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Disconnect first" }));
  await waitFor(() => expect(first).toHaveBeenCalledWith(true));

  view.rerender(<MailDisconnect key="second" connected label="Disconnect second" prompt="Keep cache?" disconnect={second}/>);
  const secondChoice = screen.getByRole<HTMLInputElement>("checkbox");
  expect(secondChoice.checked).toBe(false);
  fireEvent.click(secondChoice);
  await act(async () => complete(true));
  expect(secondChoice.checked).toBe(true);
  expect(second).not.toHaveBeenCalled();
});
