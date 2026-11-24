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
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Add attachment"})));
  expect(screen.getAllByRole("button",{name:"Remove attachment"})).toHaveLength(2);
  await act(async()=>fireEvent.click(screen.getAllByRole("button",{name:"Remove attachment"})[1]));
  expect(calls.find(request=>request.kind==="removeAttachment")).toEqual({kind:"removeAttachment",account:"a",id:"d",revision:4,attachment:"second"});
  expect(screen.queryByText(/second\.bin/)).toBeNull();
  expect(screen.getByText(/first\.bin/)).toBeTruthy();
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

function setupSavedGmailReply(legacy = false) {
  const accounts = [
    { id: "primary", address: "primary@example.test", provider: "gmail" },
    { id: "peer", address: "peer@example.test", provider: "gmail" },
  ];
  const hit = { account: "peer", address: accounts[1].address, provider: "gmail", id: "same", epoch: null,
    subject: "Peer customer mail", sender: "sender@example.test" };
  const reply = { id: "gmail-reply", revision: 1, recipient: "reply@example.test", subject: hit.subject, body: "", gmailReply: true };
  const body = { id: "same", from: hit.sender, subject: hit.subject, plainText: "Cached body" };
  const local = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "accounts") return accounts;
    if (request.kind === "drafts") return [];
    if (request.kind === "search") return { items: [hit], more: false };
    throw Error("Unexpected local operation");
  });
  let refreshed = !legacy;
  const gmail = vi.fn(async (request: Record<string, unknown>) => {
    switch (request.kind) {
      case "status": return { connected: true, read: true, send: false };
      case "cachedLabels": return [];
      case "cachedPage": return request.accountId === "peer" ? { items: [body], nextCursor: null } : null;
      case "cachedBody": return body;
      case "read": refreshed = true; return body;
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
