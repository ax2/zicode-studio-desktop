// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {Mail,setupMailApp,type Invoke} from "./index";
import {setLocale} from "../../shared/i18n";
afterEach(()=>{cleanup();vi.restoreAllMocks()});
it("keeps composing local, saves explicitly, reopens and deletes without sending",async()=>{
  setLocale("en");
  let stored:Record<string,unknown>[]=[];
  const calls:string[]=[];
  const invoke=async <T,>(request:Record<string,unknown>):Promise<T>=>{
    calls.push(String(request.kind));
    switch(request.kind){
      case "accounts":return [{id:"a",provider:"gmail",address:"me@example.test"}] as T;
      case "drafts":return stored as T;
      case "save":stored=[{...request,id:"d",revision:1}];return {id:"d",revision:1} as T;
      case "delete":stored=[];return null as T;
      default:throw Error("unexpected operation");
    }
  };
  const view=render(<Mail invoke={invoke}/>);
  fireEvent.change(await screen.findByLabelText("Mail subject"),{target:{value:"New idea"}});
  fireEvent.change(screen.getByLabelText("Message body"),{target:{value:"正文"}});
  expect(calls).not.toContain("save");
  fireEvent.click(screen.getByRole("button",{name:"Save draft"}));
  await screen.findByRole("button",{name:"New idea"});
  view.unmount();render(<Mail invoke={invoke}/>);
  const reopened=await screen.findByRole("button",{name:"New idea"});await act(async()=>fireEvent.click(reopened));
  expect((screen.getByLabelText("Message body") as HTMLTextAreaElement).value).toBe("正文");
  expect(screen.getAllByRole("searchbox",{name:"Search cached mail"})).toHaveLength(1);
  const confirmation=vi.spyOn(window,"confirm").mockReturnValue(Promise.resolve(false) as unknown as boolean);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Delete draft"})));expect(calls).not.toContain("delete");
  confirmation.mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"Delete draft"}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"New idea"})).toBe(null));
  expect(calls).toEqual(["accounts","drafts","save","accounts","drafts","delete"]);
});

it("locks account creation until the initial mailbox and drafts have both loaded",async()=>{
  setLocale("en");
  let finishAccounts:(v:unknown)=>void=()=>{},finishDrafts:(v:unknown)=>void=()=>{};
  const invoke=vi.fn((req:Record<string,unknown>)=> new Promise(resolve=>{
    if(req.kind==="accounts")finishAccounts=resolve;
    else if(req.kind==="drafts")finishDrafts=resolve;
    else throw Error("unexpected mutation during initialization");
  }));
  render(<Mail invoke={invoke as Parameters<typeof Mail>[0]["invoke"]}/>);
  const add=screen.getByRole("button",{name:"Add local account"});
  expect(add.matches(":disabled")).toBe(true);
  await act(async()=>finishAccounts([{id:"old",address:"old@example.test",provider:"gmail"}]));
  expect(add.matches(":disabled")).toBe(true);fireEvent.click(add);
  await act(async()=>finishDrafts([]));
  expect(add.matches(":disabled")).toBe(false);
  expect(invoke.mock.calls.map(([r])=>r.kind)).toEqual(["accounts","drafts"]);
});

it.each(["success", "failure"] as const)("switches accounts during a local Alibaba body read and discards its late %s", async outcome => {
  setLocale("en");
  const accounts = [
    { id: "ali", provider: "alibaba", address: "ali@example.test" },
    { id: "gmail", provider: "gmail", address: "gmail@example.test" },
  ];
  const aliMessage = { uid: 42, subject: "Alibaba result", sender: "sender@example.test" };
  const gmailMessage = { id: "42", subject: "Gmail result", from: "sender@example.test" };
  const local = vi.fn(async (request: Record<string, unknown>) => request.kind === "accounts" ? accounts : []);
  let complete!: () => void;
  const ali = vi.fn(async (request: Record<string, unknown>) => {
    switch (request.kind) {
      case "credentialStatus": return { configured: true, enabled: true };
      case "cachedFolders": return [];
      case "cachedPage": return { uidValidity: 7, messages: [aliMessage], next: null };
      case "cachedBody": return new Promise((resolve, reject) => {
        complete = () => outcome === "success" ? resolve({ summary: aliMessage, text: "Stale body" }) : reject(Error("mail_storage"));
      });
      default: throw Error("Unexpected Alibaba operation");
    }
  });
  const gmail = vi.fn(async (request: Record<string, unknown>) => {
    switch (request.kind) {
      case "status": return { connected: false };
      case "cachedLabels": return [];
      case "cachedPage": return { items: [gmailMessage], nextCursor: null };
      case "cachedBody": return { ...gmailMessage, plainText: "Current cached body" };
      default: throw Error("Unexpected Gmail operation");
    }
  });
  render(<Mail invoke={local as Invoke} transport={ali as Invoke} gmailTransport={gmail as Invoke} />);
  fireEvent.click(await screen.findByRole("button", { name: /Alibaba result/ }));
  await screen.findByText("Loading…");
  const account = screen.getByLabelText<HTMLSelectElement>("Mail account");
  expect(account.matches(":disabled")).toBe(false);
  expect(screen.getByRole("button", { name: "Add local account" }).matches(":disabled")).toBe(true);
  fireEvent.change(account, { target: { value: "gmail" } });
  fireEvent.click(await screen.findByRole("button", { name: /Gmail result/ }));
  await screen.findByText("Current cached body");
  await act(async () => complete());
  expect(screen.getByText("Current cached body")).toBeTruthy();
  expect(screen.queryByText("Stale body")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(ali.mock.calls.map(([request]) => request.kind)).not.toContain("read");
  expect(gmail).toHaveBeenCalledWith({ kind: "cachedBody", accountId: "gmail", id: "42" });
});

it("retains unsaved mail when its tool tab closes and the surface is reattached",async()=>{
  setLocale("en");
  const invoke=async<T,>(r:Record<string,unknown>)=>(r.kind==="accounts"?[{id:"a",provider:"alibaba",address:"a@example.test"}]:[]) as T;
  const app=setupMailApp(invoke),one=document.createElement("div"),two=document.createElement("div");
  document.body.append(one,two);
  try{
    await act(async()=>app.renderContent(one));
    fireEvent.change(await screen.findByLabelText("Message body"),{target:{value:"unsaved text"}});
    app.deactivate();one.replaceChildren();
    await act(async()=>app.renderContent(two));
    expect((screen.getByLabelText("Message body") as HTMLTextAreaElement).value).toBe("unsaved text");
    expect(screen.getByRole("button",{name:"Save draft"}).matches(":disabled")).toBe(false);
  }finally{await act(async()=>app.destroy());one.remove();two.remove()}
});

it("keeps attachments on picker cancellation and removes only the selected saved attachment",async()=>{
  setLocale("en");
  const calls:Record<string,unknown>[]=[];
  let files=[{id:"first",name:"first.bin",size:3},{id:"second",name:"second.bin",size:7}];
  const invoke=async <T,>(request:Record<string,unknown>):Promise<T>=>{
    calls.push(request);
    switch(request.kind){
      case "accounts": return [{id:"a",provider:"gmail",address:"me@example.test"}] as T;
      case "drafts": return [{id:"d",subject:"Files",recipient:"",body:"",revision:files.length===2?4:5,attachments:files}] as T;
      case "pickAttachment": return {changed:false} as T;
      case "removeAttachment":
        files=files.filter(file=>file.id!==request.attachment);
        return {changed:true,revision:5} as T;
      default: throw Error("unexpected operation");
    }
  };
  render(<Mail invoke={invoke}/>);
  const draftButton = await screen.findByRole("button",{name:"Files"});
  await act(async()=>fireEvent.click(draftButton));
  const add = screen.getByRole("button", { name: "Add attachment" });
  add.focus();
  await act(async()=>fireEvent.click(add));
  expect(document.activeElement).toBe(add);
  expect(screen.getAllByRole("button",{name:"Remove attachment"})).toHaveLength(2);
  const remove = screen.getAllByRole("button", { name: "Remove attachment" })[1];
  remove.focus();
  await act(async()=>fireEvent.click(remove));
  expect(calls.find(request=>request.kind==="removeAttachment")).toEqual({kind:"removeAttachment",account:"a",id:"d",revision:4,attachment:"second"});
  expect(screen.queryByText(/second\.bin/)).toBeNull();
  expect(screen.getByText(/first\.bin/)).toBeTruthy();
  expect(document.activeElement).toBe(add);
});

it("keeps deliberate focus movement and does not replay attachment focus after opening another draft", async () => {
  setLocale("en");
  const drafts = [
    { id: "first", revision: 4, subject: "Draft one", recipient: "", body: "Previous draft" },
    { id: "second", revision: 7, subject: "Draft two", recipient: "", body: "Current draft" },
  ];
  let finish!: () => void;
  const invoke = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "accounts") return [{ id: "a", provider: "gmail", address: "one@example.test" }];
    if (request.kind === "drafts") return drafts;
    if (request.kind === "pickAttachment") return new Promise(resolve => {
      finish = () => resolve({ changed: false });
    });
    throw Error("Unexpected local request");
  });
  render(<Mail invoke={invoke as Invoke} />);
  const first = await screen.findByRole("button", { name: "Draft one" });
  await act(async () => fireEvent.click(first));
  const add = screen.getByRole("button", { name: "Add attachment" });
  add.focus();
  fireEvent.click(add);
  const second = screen.getByRole("button", { name: "Draft two" });
  expect(second.matches(":disabled")).toBe(true);
  const search = screen.getByRole("searchbox", { name: "Search cached mail" });
  search.focus();
  search.blur();
  await act(async () => finish());
  expect(document.activeElement).toBe(document.body);
  await act(async () => fireEvent.click(second));
  expect((screen.getByLabelText("Message body") as HTMLTextAreaElement).value).toBe("Current draft");
  expect(document.activeElement).not.toBe(add);
  expect(invoke.mock.calls.filter(([request]) => request.kind === "pickAttachment")).toEqual([
    [{ kind: "pickAttachment", account: "a", id: "first", revision: 4 }],
  ]);
});

it.each([["gmail", "pickAttachment"], ["alibaba", "removeAttachment"]])(
  "reloads the saved %s draft after a successful attachment change and failed read",
  async (provider, operation) => {
    setLocale("en");
    const original = { id: "d", revision: 4, subject: "Saved fixture", recipient: "to@example.test", body: "Saved content",
      attachments: [{ id: "a", name: "initial.bin", size: 3 }] };
    const updated = { ...original, revision: 5, attachments: operation === "pickAttachment"
      ? [...original.attachments, { id: "b", name: "added.bin", size: 7 }] : [] };
    let changed = false;
    let readAfterChange = 0;
    const invoke = vi.fn(async (request: Record<string, unknown>) => {
      if (request.kind === "accounts") return [{ id: "one", provider, address: "one@example.test" }];
      if (request.kind === operation) { changed = true; return { changed: true, revision: 5 }; }
      if (request.kind === "drafts" && request.account === "one") {
        if (!changed) return [original];
        if (++readAfterChange === 1) throw Error("mail_storage");
        return [readAfterChange === 2 ? original : updated];
      }
      throw Error("unexpected request");
    });
    const adapter = vi.fn(async (request: Record<string, unknown>) => {
      switch (request.kind) {
        case "status": return { connected: true, send: true };
        case "credentialStatus": return { configured: true, enabled: true };
        case "cachedPage": return provider === "gmail" ? null : { messages: [], next: null };
        case "cachedLabels":
        case "cachedFolders": return [];
        case "delivery": return provider === "gmail" ? null : { status: null };
        default: throw Error("unexpected provider operation");
      }
    });
    render(<Mail invoke={invoke as Invoke} gmailTransport={provider === "gmail" ? adapter as Invoke : undefined}
      transport={provider === "alibaba" ? adapter as Invoke : undefined}/>);
    const selected = await screen.findByRole("button", { name: "Saved fixture" });
    await act(async () => fireEvent.click(selected));
    await screen.findByRole("region", { name: "Send saved draft" });
    const control = operation === "pickAttachment" ? "Add attachment" : "Remove attachment";
    const action = screen.getByRole("button", { name: control });
    action.focus();
    await act(async () => fireEvent.click(action));
    expect((await screen.findByRole("alert")).textContent).toContain("Attachment change saved");
    expect(screen.queryByRole("region", { name: "Send saved draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: control })).toBeNull();
    const retry = screen.getByRole("button", { name: "Reload draft attachments" });
    expect(document.activeElement).toBe(retry);
    await act(async () => fireEvent.click(retry));
    expect(screen.queryByRole("region", { name: "Send saved draft" })).toBeNull();
    await act(async () => fireEvent.click(retry));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Saved fixture" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("Message body") as HTMLTextAreaElement).value).toBe("Saved content");
    expect(screen.queryByText(operation === "pickAttachment" ? /added\.bin/ : /initial\.bin/) !== null)
      .toBe(operation === "pickAttachment");
    expect(invoke.mock.calls.map(([request]) => request)).toEqual([
      { kind: "accounts" }, { kind: "drafts", account: "one" },
      { kind: operation, account: "one", id: "d", revision: 4, ...(operation === "removeAttachment" && { attachment: "a" }) },
      ...Array.from({ length: 3 }, () => ({ kind: "drafts", account: "one" })),
    ]);
    const delivery = adapter.mock.calls.map(([request]) => request).filter(request => request.kind === "delivery");
    expect(delivery.map(request => request.revision)).toEqual([4, 5]);
    expect(adapter.mock.calls.some(([request]) => request.kind === "send")).toBe(false);
  },
);

it("does not restore a draft from a late attachment reread after the mail source changes", async () => {
  setLocale("en");
  const original = { id: "same-id", revision: 4, subject: "Previous source", recipient: "", body: "Previous source text" };
  const replacement = { ...original, subject: "Current source", body: "Current source text" };
  const account = [{ id: "same-account", provider: "gmail", address: "owner@example.test" }];
  let finish: (rows: unknown) => void = () => {};
  let read = 0;
  const previous = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "accounts") return account;
    if (request.kind === "pickAttachment") return { changed: true, revision: 5 };
    if (request.kind === "drafts") {
      if (++read === 1) return [original];
      if (read === 2) throw Error("mail_storage");
      return new Promise(resolve => { finish = resolve; });
    }
    throw Error("unexpected request");
  });
  const current = vi.fn(async (request: Record<string, unknown>) => request.kind === "accounts" ? account : [replacement]);
  const view = render(<Mail invoke={previous as Invoke}/>);
  const previousDraft = await screen.findByRole("button", { name: "Previous source" });
  await act(async () => fireEvent.click(previousDraft));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add attachment" })));
  fireEvent.click(await screen.findByRole("button", { name: "Reload draft attachments" }));
  await waitFor(() => expect(read).toBe(3));
  view.rerender(<Mail invoke={current as Invoke}/>);
  const currentDraft = await screen.findByRole("button", { name: "Current source" });
  await act(async () => fireEvent.click(currentDraft));
  await act(async () => finish([{ ...original, revision: 5, attachments: [{ id: "a", name: "old.bin", size: 3 }] }]));
  expect((screen.getByLabelText("Message body") as HTMLTextAreaElement).value).toBe("Current source text");
  expect(screen.queryByText(/old\.bin/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Reload draft attachments" })).toBeNull();
});

it.each(["accounts", "drafts"])("hides a stale draft when the replacement source fails to read %s", async failedRead => {
  setLocale("en");
  const account = [{ id: "same-account", provider: "gmail", address: "owner@example.test" }];
  const draft = { id: "same-draft", revision: 4, subject: "Previous scope draft", recipient: "", body: "Previous scope only" };
  let changed = false;
  const previous = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "accounts") return account;
    if (request.kind === "pickAttachment") { changed = true; return { changed: true, revision: 5 }; }
    if (request.kind === "drafts" && !changed) return [draft];
    throw Error("mail_storage");
  });
  const replacement = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === failedRead) throw Error("mail_storage");
    if (request.kind === "accounts") return account;
    throw Error("unexpected request");
  });
  const view = render(<Mail invoke={previous as Invoke}/>);
  const old = await screen.findByRole("button", { name: draft.subject });
  await act(async () => fireEvent.click(old));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add attachment" })));
  await screen.findByRole("button", { name: "Reload draft attachments" });
  view.rerender(<Mail invoke={replacement as Invoke}/>);
  await screen.findByText(failedRead === "accounts" ? "Could not access local mail data." : "Could not load this account’s saved drafts.");
  expect(screen.queryByRole("combobox", { name: "Mail account" }) !== null).toBe(failedRead === "drafts");
  expect(screen.queryByRole("button", { name: "Reload drafts" }) !== null).toBe(failedRead === "drafts");
  expect(screen.queryByRole("button", { name: draft.subject })).toBeNull();
  expect(screen.queryByLabelText("Message body")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add attachment" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
  expect(replacement.mock.calls.map(([request]) => request.kind))
    .toEqual(failedRead === "accounts" ? ["accounts"] : ["accounts", "drafts"]);
});

it("keeps accounts and cached mail available while the selected account’s drafts cannot load", async () => {
  setLocale("en");
  let recovered = false;
  const invoke = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "accounts") return ["a", "b"].map(id => ({ id, provider: "gmail", address: id + "@example.test" }));
    if (request.kind !== "drafts") throw Error("unexpected local write");
    if (request.account === "a" && !recovered) throw Error("mail_storage");
    return [{ id: "same-draft", revision: 1, recipient: "", subject: "Draft " + request.account, body: "Text " + request.account }];
  });
  const remote = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "status") return { connected: false };
    if (request.kind === "cachedLabels") return [];
    if (request.kind === "cachedPage") return { items: [{ id: "42", subject: "Cached " + request.accountId }], nextCursor: null };
    if (request.kind === "cachedBody") return { id: "42", plainText: "Offline body " + request.accountId };
    throw Error("unexpected mail operation");
  });
  render(<Mail invoke={invoke as Invoke} gmailTransport={remote as Invoke} />);
  await screen.findByText("Could not load this account’s saved drafts.");
  fireEvent.click(await screen.findByRole("button", { name: /Cached a/ }));
  await screen.findByText("Offline body a");
  expect(screen.queryByLabelText("Message body")).toBeNull();
  expect(screen.getByRole("button", { name: "Create reply draft" }).matches(":disabled")).toBe(true);
  const account = screen.getByRole("combobox", { name: "Mail account" });
  fireEvent.change(account, { target: { value: "b" } });
  await screen.findByRole("button", { name: "Draft b" });
  expect(screen.queryByText("Offline body a")).toBeNull();
  fireEvent.change(account, { target: { value: "a" } });
  await screen.findByText("Could not load this account’s saved drafts.");
  expect(screen.queryByRole("button", { name: "Draft b" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: /Cached a/ }));
  await screen.findByText("Offline body a");
  recovered = true;
  fireEvent.click(screen.getByRole("button", { name: "Reload drafts" }));
  await screen.findByRole("button", { name: "Draft a" });
  expect(screen.getByText("Offline body a")).toBeTruthy();
  expect(screen.queryByText("Could not load this account’s saved drafts.")).toBeNull();
  expect(invoke.mock.calls.filter(([request]) => request.kind === "drafts").map(([request]) => request.account)).toEqual(["a", "b", "a", "a"]);
});


function setupCachedReply() {
  setLocale("en");
  const accounts = [
    { id: "current", address: "current@example.test", provider: "gmail" },
    { id: "source", address: "source@example.test", provider: "alibaba" },
  ];
  const hits = [
    { account: "source", address: accounts[1].address, provider: "alibaba", folder: "Archive", epoch: 9, id: "42",
      subject: "Archived supplier message", sender: "supplier@example.test" },
    { account: "current", address: accounts[0].address, provider: "gmail", epoch: null, id: "42",
      subject: "Gmail message with the same ID", sender: "different@example.test" },
  ];
  const reply = { id: "reply", revision: 1, recipient: "reply@example.test", subject: "Re: Archived supplier message", body: "" };
  const original = { id: "existing", revision: 2, recipient: "keep@example.test", subject: "Original source draft", body: "keep" };
  const invoke = vi.fn(async (request: Record<string, unknown>) => {
    switch (request.kind) {
      case "accounts": return accounts;
      case "drafts": return request.account === "source" ? [original] : [];
      case "search": return { items: hits, more: false };
      default: throw Error("Unexpected local operation");
    }
  });
  const transport = vi.fn(async (request: Record<string, unknown>) => {
    switch (request.kind) {
      case "credentialStatus": return { configured: false, enabled: false };
      case "cachedPage": return null;
      case "cachedFolders": return [];
      case "cachedBody": throw Error("mail_cache_empty");
      case "replyDraft": return reply;
      default: throw Error("Unexpected Alibaba operation");
    }
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<Mail invoke={invoke as Invoke} transport={transport as Invoke}/>);
  return { invoke, transport, confirm, reply };
}

async function showCachedAlibabaMessage() {
  fireEvent.change(await screen.findByLabelText("Search scope"), { target: { value: "" } });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search cached mail" }), { target: { value: "message" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /Archived supplier message/ }));
  const read = within(screen.getByRole("article", { name: "Cached message" }));
  await read.findByRole("button", { name: "Download message body" });
  return read;
}

it("creates an offline reply on the result's account and opens the saved draft", async () => {
  const { transport, confirm, reply } = setupCachedReply();
  const read = await showCachedAlibabaMessage();
  const edit = screen.getByLabelText<HTMLInputElement>("Mail subject");
  fireEvent.change(edit, { target: { value: "Keep unsaved changes" } });
  const create = read.getByRole("button", { name: "Create reply draft" });
  await act(async () => { fireEvent.click(create); });
  expect(confirm).toHaveBeenCalledWith("Discard unsaved draft changes?");
  expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("current");
  expect(edit.value).toBe("Keep unsaved changes");
  expect(transport.mock.calls.filter(([r]) => r.kind === "replyDraft")).toHaveLength(0);

  const backend = transport.getMockImplementation();
  let finishMailbox: (status: { configured: boolean; enabled: boolean }) => void = () => {};
  transport.mockImplementation(request => request.kind === "credentialStatus"
    ? new Promise(resolve => { finishMailbox = resolve; }) : backend?.(request) ?? Promise.reject(Error("Missing fixture")));
  confirm.mockReturnValue(true);
  await act(async () => { fireEvent.click(create); fireEvent.click(create); });
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("source"));
  expect(screen.getByLabelText<HTMLInputElement>("Mail subject").value).toBe(reply.subject);
  expect(screen.getByLabelText<HTMLInputElement>("Recipient").value).toBe(reply.recipient);
  expect(screen.getByRole("button", { name: "Original source draft" })).toBeTruthy();
  const body = screen.getByLabelText<HTMLTextAreaElement>("Message body");
  expect(body.matches(":disabled")).toBe(true);
  await act(async () => finishMailbox({ configured: false, enabled: false }));
  await waitFor(() => expect(document.activeElement).toBe(body));
  expect(transport.mock.calls.filter(([r]) => r.kind === "replyDraft").map(([r]) => r)).toEqual([
    { kind: "replyDraft", accountId: "source", folder: "Archive", uidValidity: 9, uid: 42 },
  ]);
  expect(transport.mock.calls.some(([r]) => r.kind === "read" || r.kind === "send")).toBe(false);
  expect(screen.getByLabelText<HTMLInputElement>("Search cached mail").value).toBe("message");
  expect(screen.getByLabelText<HTMLSelectElement>("Search scope").value).toBe("");
  expect(screen.getByRole("button", { name: /Gmail message with the same ID/ })).toBeTruthy();
  expect(within(screen.getByRole("article", { name: "Cached message" })).getByText("Archived supplier message")).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Mail account"), { target: { value: "current" } });
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("current"));
  expect(screen.getByLabelText<HTMLInputElement>("Search cached mail").value).toBe("");
  expect(screen.getByLabelText<HTMLSelectElement>("Search scope").value).toBe("current");
  expect(screen.queryByRole("article", { name: "Cached message" })).toBeNull();
});

it("does not create a reply after the search source changes during confirmation", async () => {
  const { transport, confirm } = setupCachedReply();
  const read = await showCachedAlibabaMessage();
  const edit = screen.getByLabelText<HTMLInputElement>("Mail subject");
  fireEvent.change(edit, { target: { value: "Existing unsaved draft" } });
  let confirmLater: (choice: boolean) => void = () => {};
  confirm.mockReturnValue(new Promise<boolean>(resolve => { confirmLater = resolve; }) as unknown as boolean);
  fireEvent.click(read.getByRole("button", { name: "Create reply draft" }));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: /Gmail message with the same ID/ }));
  await act(async () => confirmLater(true));
  expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("current");
  expect(edit.value).toBe("Existing unsaved draft");
  expect(transport.mock.calls.some(([r]) => r.kind === "replyDraft")).toBe(false);
  const gmail = within(screen.getByRole("article", { name: "Cached message" }));
  expect(gmail.getByText("Gmail message with the same ID")).toBeTruthy();
  expect(gmail.queryByRole("button", { name: "Create reply draft" })).toBeNull();
});

it("reports a stale cached source next to the reply action and permits retry", async () => {
  const { transport, reply } = setupCachedReply();
  const read = await showCachedAlibabaMessage();
  const backend = transport.getMockImplementation();
  transport.mockImplementation(request => request.kind === "replyDraft"
    ? Promise.reject(Error("mail_cache_empty")) : backend?.(request) ?? Promise.reject(Error("Missing fixture")));
  fireEvent.click(read.getByRole("button", { name: "Create reply draft" }));
  expect((await read.findByRole("alert")).textContent).toBe("This cached message is unavailable. Search again before replying.");
  expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("current");

  transport.mockImplementation(request => request.kind === "replyDraft" ? Promise.resolve(reply) : backend?.(request) ?? Promise.reject(Error("Missing fixture")));
  fireEvent.click(read.getByRole("button", { name: "Create reply draft" }));
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("source"));
  expect(transport.mock.calls.filter(([r]) => r.kind === "replyDraft")).toHaveLength(2);
});

function setupSavedGmailReply(legacy = false, beforeRefresh?: (attempt: number) => Promise<void>) {
  setLocale("en");
  const accounts = [
    { id: "primary", address: "primary@example.test", provider: "gmail" },
    { id: "peer", address: "peer@example.test", provider: "gmail" },
  ];
  const hit = { account: "peer", address: accounts[1].address, provider: "gmail", id: "same", epoch: null,
    subject: "Peer customer mail", sender: "sender@example.test" };
  const reply = { id: "gmail-reply", revision: 1, recipient: "reply@example.test", subject: hit.subject, body: "", gmailReply: true };
  const body = { id: "same", from: hit.sender, subject: hit.subject, plainText: "Cached body",
    ...(beforeRefresh && { attachments: [{ id: 0, name: "existing.txt", size: 12 }] }) };
  const local = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "accounts") return accounts;
    if (request.kind === "drafts") return [];
    if (request.kind === "search") return { items: [hit], more: false };
    throw Error("Unexpected local operation");
  });
  let refreshed = !legacy;
  let refreshAttempt = 0;
  const gmail = vi.fn(async (request: Record<string, unknown>) => {
    switch (request.kind) {
      case "status": return { connected: true, read: true, send: false };
      case "cachedLabels": return [];
      case "cachedPage": return request.accountId === "peer" ? { items: [body], nextCursor: null } : null;
      case "cachedBody": return body;
      case "read":
        await beforeRefresh?.(++refreshAttempt);
        refreshed = true;
        return beforeRefresh ? { ...body, plainText: "Refreshed body", attachments: [{ id: 0, name: "updated.txt", size: 15 }] } : body;
      case "replyDraft":
        if (!refreshed) throw Error("gmail_reply_metadata_missing");
        if (request.accountId !== "peer" || request.id !== "same") throw Error("Wrong source");
        return reply;
      default: throw Error("Unexpected Gmail operation");
    }
  });
  render(<Mail invoke={local as Invoke} gmailTransport={gmail as Invoke}/>);
  return { gmail, reply };
}

async function showGmailMail(source: "inbox" | "search") {
  const account = await screen.findByLabelText<HTMLSelectElement>("Mail account");
  if (source === "inbox") {
    fireEvent.change(account, { target: { value: "peer" } });
    fireEvent.click(await screen.findByRole("button", { name: /Peer customer mail/ }));
  } else {
    fireEvent.change(await screen.findByLabelText("Search scope"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search cached mail" }), { target: { value: "customer" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: /Peer customer mail/ }));
  }
  return within(screen.getByRole("article", { name: source === "inbox" ? "Selected message" : "Cached message" }));
}

it.each(["inbox", "search"] as const)("opens a Gmail reply from the %s without separate read or send calls", async source => {
  const { gmail, reply } = setupSavedGmailReply();
  const reading = await showGmailMail(source);
  const create = await reading.findByRole("button", { name: "Create reply draft" });
  await waitFor(() => expect(create.matches(":disabled")).toBe(false));
  fireEvent.click(create);
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("peer"));
  expect(await screen.findByText("Changing the recipient or subject sends this as a new message.")).toBeTruthy();
  expect(screen.getByLabelText<HTMLInputElement>("Recipient").value).toBe(reply.recipient);
  expect(screen.getByLabelText<HTMLInputElement>("Mail subject").value).toBe(reply.subject);
  await waitFor(() => expect(screen.getByLabelText("Message body")).toBe(document.activeElement));
  const actions = gmail.mock.calls.map(([request]) => request).filter(request => ["read", "send", "replyDraft"].includes(String(request.kind)));
  expect(actions).toEqual([{ kind: "replyDraft", accountId: "peer", id: "same" }]);
  if (source === "search") {
    expect(screen.getByLabelText<HTMLInputElement>("Search cached mail").value).toBe("customer");
    expect(screen.getByLabelText<HTMLSelectElement>("Search scope").value).toBe("");
    expect(within(screen.getByRole("article", { name: "Cached message" })).getByText("Cached body")).toBeTruthy();
  }
});

it.each(["inbox", "search"] as const)("refreshes a legacy Gmail message from the %s only after an explicit click", async source => {
  const { gmail, reply } = setupSavedGmailReply(true);
  const reading = await showGmailMail(source);
  const create = await reading.findByRole("button", { name: "Create reply draft" });
  await waitFor(() => expect(create.matches(":disabled")).toBe(false));
  fireEvent.click(create);
  const refresh = await reading.findByRole("button", { name: "Refresh message to reply" });
  expect(gmail.mock.calls.some(([request]) => request.kind === "read")).toBe(false);
  fireEvent.click(refresh);
  await waitFor(() => expect(gmail.mock.calls.filter(([request]) => request.kind === "read").map(([request]) => request))
    .toEqual([{ kind: "read", accountId: "peer", id: "same" }]));
  await waitFor(() => expect(reading.getByRole("button", { name: "Create reply draft" }).matches(":disabled")).toBe(false));
  fireEvent.click(reading.getByRole("button", { name: "Create reply draft" }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Recipient").value).toBe(reply.recipient));
  expect(gmail.mock.calls.some(([request]) => request.kind === "send")).toBe(false);
});

it.each(["inbox", "search"] as const)("keeps the cached Gmail %s body and reply refresh after a failed explicit refresh", async source => {
  let rejectRefresh!: (error: Error) => void;
  const first = new Promise<void>((_resolve, reject) => { rejectRefresh = reject; });
  const { gmail, reply } = setupSavedGmailReply(true, async attempt => { if (attempt === 1) await first; });
  const reading = await showGmailMail(source);
  await reading.findByText("Cached body");
  fireEvent.click(reading.getByRole("button", { name: "Create reply draft" }));
  const refresh = await reading.findByRole("button", { name: "Refresh message to reply" });
  expect(gmail.mock.calls.some(([request]) => request.kind === "read")).toBe(false);

  fireEvent.click(refresh);
  expect(reading.queryByText("Cached body")).toBeTruthy();
  expect(reading.getByRole("button", { name: "Download attachment existing.txt" })).toBeTruthy();
  expect(refresh.matches(":disabled")).toBe(true);
  await act(async () => rejectRefresh(Error("gmail_network")));
  await screen.findByText("Could not connect to the mail server. Your local data is unchanged.");
  expect(reading.queryByText("Cached body")).toBeTruthy();
  expect(reading.getByRole("button", { name: "Download attachment existing.txt" })).toBeTruthy();
  expect(refresh.matches(":disabled")).toBe(false);
  expect(reading.queryByRole("button", { name: "Download message body" })).toBeNull();

  fireEvent.click(refresh);
  await reading.findByText("Refreshed body");
  expect(reading.queryByRole("button", { name: "Download attachment existing.txt" })).toBeNull();
  expect(reading.getByRole("button", { name: "Download attachment updated.txt" })).toBeTruthy();
  expect(reading.queryByRole("button", { name: "Refresh message to reply" })).toBeNull();
  const readRequests = gmail.mock.calls.map(([r]) => r).filter(r => r.kind === "read");
  expect(readRequests).toEqual(Array.from({ length: 2 }, () => ({ kind: "read", accountId: "peer", id: "same" })));
  fireEvent.click(reading.getByRole("button", { name: "Create reply draft" }));
  await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("Recipient").value).toBe(reply.recipient));
  expect(gmail.mock.calls.some(([request]) => request.kind === "send")).toBe(false);
});


it("drops a pending reply refresh when the Gmail search scope changes", async () => {
  let finish!: () => void;
  const deferred = new Promise<void>(resolve => { finish = resolve; });
  const { gmail } = setupSavedGmailReply(true, () => deferred);
  const reading = await showGmailMail("search");
  await reading.findByText("Cached body");
  fireEvent.click(reading.getByRole("button", { name: "Create reply draft" }));
  fireEvent.click(await reading.findByRole("button", { name: "Refresh message to reply" }));
  fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "primary" } });
  await act(async () => finish());
  expect(screen.queryByRole("article", { name: "Cached message" })).toBeNull();
  expect(screen.queryByText("Refreshed body")).toBeNull();
  expect(screen.getByLabelText<HTMLSelectElement>("Search scope").value).toBe("primary");
  expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("primary");
  expect(gmail.mock.calls.map(([r]) => r).filter(r => r.kind === "read")).toEqual([
    { kind: "read", accountId: "peer", id: "same" },
  ]);
});
