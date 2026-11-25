import {act,cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {Mail,type Invoke} from "./index";
import { AlibabaInbox } from "./AlibabaInbox";
import {setLocale} from "../../shared/i18n";
afterEach(()=>{cleanup();vi.restoreAllMocks()});
const summary={uid:30,subject:"Inbox fixture",sender:"from@example.test",replyTo:"reply@example.test"};
function setup(provider="alibaba",initiallyConfigured=true,backlog=0,archiveBody?:string){
  setLocale("en");let configured=initiallyConfigured,delivery:string|null=null;
  let draft={id:"draft",revision:2,subject:"Prepared",recipient:"receiver@example.test",body:"Draft body "+"x".repeat(480)+"<img src=fixture>"};
  const local=vi.fn(async (r:Record<string,unknown>)=>{
    if(r.kind==="accounts")return [{id:"a",address:"me@example.test",provider}];
    if(r.kind==="drafts")return [draft];throw Error("unexpected local write");
  });
  const remote=vi.fn(async (r:Record<string,unknown>): Promise<unknown> =>{
    expect(r.accountId).toBe("a");
    switch(r.kind){
    case "credentialStatus":return {enabled:true,configured};
    case "setPassword":configured=true;return {configured};
    case "forgetPassword":configured=false;return {configured};
    case "cachedFolders":return [{id:"Archive",name:"Archive"}];
    case "cachedPage":return {uidValidity:7,messages:[r.folder==="Archive"?{...summary,subject:"Archive fixture"}:summary],next:null};
    case "catchUp":return --backlog>0;
    case "sync":return r.cursor
      ?{uidValidity:7,messages:[{...summary,uid:10,subject:"Older fixture"}],next:null}
      :{uidValidity:7,messages:[summary],pending:backlog>0,next:{uidValidity:7,before:30}};
    case "cachedBody":if(archiveBody && r.folder==="Archive")return {summary,text:archiveBody};throw Error("mail_cache_empty");
    case "read":return {summary,text:"<img src='https://invalid.test/x'>"};
    case "replyDraft":draft={id:"reply",revision:1,subject:"Re: Inbox fixture",recipient:summary.replyTo,body:""};return draft;
    case "delivery":return {status:delivery};
    case "send":expect(r).toMatchObject({draftId:"draft",revision:2,confirmed:true});delivery="unknown";return {status:delivery};
    default:throw Error("unexpected remote operation");
    }
  });
  const view=render(<Mail invoke={local as Invoke} transport={remote as Invoke}/>);
  return {remote,local,view,kinds:()=>remote.mock.calls.map(c=>c[0].kind)};
}
const button=(name:string)=>screen.getByRole("button",{name});
it("explains why a clipped header cannot be used to create a reply", async () => {
  setLocale("en");
  const clipped = { ...summary, headerLimited: true };
  const read = vi.fn(async (request: Record<string, unknown>) => {
    switch (request.kind) {
      case "credentialStatus": return { configured: true, enabled: true };
      case "cachedFolders": return [];
      case "cachedPage": return { uidValidity: 7, messages: [clipped], next: null };
      case "cachedBody": return { summary: clipped, text: "Clipped message body" };
      default: throw Error("unexpected operation");
    }
  });
  render(<AlibabaInbox id="a" folder="INBOX" setFolder={vi.fn()} invoke={read as Invoke}
    discard={() => true} onReply={vi.fn()} onConfigured={vi.fn()} onBusy={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Clipped message body");
  expect(screen.getByText("Only part of the message header could be read. Reply is unavailable.")).toBeTruthy();
  const reply = button("Create reply draft") as HTMLButtonElement;
  expect(reply.disabled).toBe(true);
  fireEvent.click(reply);
  expect(read.mock.calls.map(([request]) => request.kind)).not.toContain("replyDraft");
});
it("automatically finishes pending refresh pages without waiting for manual pagination",async()=>{
  const a=setup("alibaba",true,2);
  await screen.findByText("Inbox fixture");
  fireEvent.click(button("Refresh from server"));
  await screen.findByText("Showing messages retrieved from the server.");
  expect(a.kinds().filter(kind=>kind==="catchUp")).toHaveLength(2);
});
it("switches to an offline folder and reads the same UID in that folder",async()=>{
  const a=setup();
  const select=await screen.findByLabelText("IMAP folder");
  await screen.findByText("Inbox fixture");
  fireEvent.change(select,{target:{value:"Archive"}});
  fireEvent.click(await screen.findByRole("button",{name:/Archive fixture/}));
  expect(a.remote).toHaveBeenCalledWith({kind:"cachedBody",accountId:"a",folder:"Archive",uid:30,uidValidity:7});
  expect(screen.queryByText("Inbox fixture")).toBeNull();
  expect(a.kinds()).not.toContain("sync");
});
it("reads cached headers without network, paginates only on demand, and creates an offline reply",async()=>{
  const a=setup();await screen.findByRole("button",{name:/Inbox fixture/});
  expect(a.kinds()).toEqual(["cachedFolders","credentialStatus","cachedPage","cachedFolders"]);
  fireEvent.click(screen.getByRole("button",{name:/Inbox fixture/}));
  await screen.findByText(/not available offline/);
  expect(a.kinds()).not.toContain("read");
  fireEvent.click(button("Download message body"));await screen.findByText("<img src='https://invalid.test/x'>");
  fireEvent.click(button("Refresh from server"));await screen.findByRole("button",{name:"Load older messages"});
  fireEvent.click(button("Load older messages"));await screen.findByRole("button",{name:/Older fixture/});
  fireEvent.click(screen.getByRole("button",{name:/Inbox fixture/}));await screen.findByText("<img src='https://invalid.test/x'>");expect(document.querySelector("article img")).toBeNull();
  expect(a.kinds().filter(k=>k==="read")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Message body"),{target:{value:"Keep editing"}});
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(Promise.resolve(false) as unknown as boolean);
  await act(async()=>fireEvent.click(button("Create reply draft")));expect(a.kinds()).not.toContain("replyDraft");
  confirm.mockReturnValue(true);fireEvent.click(button("Create reply draft"));await waitFor(()=>expect((screen.getByLabelText("Recipient") as HTMLInputElement).value).toBe("reply@example.test"));
  expect(a.kinds()).not.toContain("send");
});
it("reviews the saved recipient and blocks resubmission after an unknown delivery outcome",async()=>{
  const a=setup();fireEvent.click(await screen.findByRole("button",{name:"Prepared"}));
  const review=await screen.findByRole("button",{name:"Review before sending"});
  await waitFor(()=>expect(review.matches(":disabled")).toBe(false));
  fireEvent.click(review);const confirmation=within(screen.getByRole("region",{name:"Confirm sending email"}));expect(confirmation.getByText("receiver@example.test")).toBeTruthy();expect(confirmation.getByText("me@example.test")).toBeTruthy();
  const preview=within(confirmation.getByRole("region",{name:"Message body preview"}));expect(preview.getByText(/^Draft body/).textContent?.endsWith("…")).toBe(true);
  fireEvent.click(preview.getByRole("button",{name:"Show full message body"}));expect(preview.getByText(/^Draft body/).textContent).toBe("Draft body "+"x".repeat(480)+"<img src=fixture>");expect(document.querySelector(".mail-send-review img")).toBeNull();
  fireEvent.click(button("Cancel"));expect(a.kinds()).not.toContain("send");
  fireEvent.click(review);fireEvent.click(button("Confirm and send email"));
  await screen.findByText(/Delivery is unknown/);
  expect(screen.queryByRole("button",{name:"Confirm and send email"})).toBeNull();
  fireEvent.click(button("New draft"));fireEvent.click(button("Prepared"));await screen.findByText(/Delivery is unknown/);
  expect(a.kinds().filter(k=>k==="send")).toHaveLength(1);
});
it("saves client credentials explicitly and hides provider actions for a Gmail draft",async()=>{
  const a=setup("alibaba",false);await screen.findByRole("button",{name:/Inbox fixture/});
  const secret=screen.getByLabelText("Client password") as HTMLInputElement;
  fireEvent.change(secret,{target:{value:"synthetic-only"}});expect(a.kinds()).not.toContain("setPassword");
  fireEvent.click(button("Save client password"));await screen.findByText(/Client password saved/);expect(secret.value).toBe("");
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(Promise.resolve(false) as unknown as boolean);
  await act(async()=>fireEvent.click(button("Remove client password")));expect(a.kinds()).not.toContain("forgetPassword");
  confirm.mockReturnValue(true);fireEvent.click(button("Remove client password"));await waitFor(()=>expect(button("Refresh from server").matches(":disabled")).toBe(true));
  a.view.unmount();const gmail=setup("gmail");await screen.findByRole("button",{name:"Prepared"});
  expect(gmail.kinds()).toHaveLength(0);expect(screen.queryByRole("button",{name:"Refresh from server"})).toBeNull();
});

it.each([true, false])("retries credential status without losing cached mail (credentials enabled: %s)", async enabled => {
  const a = setup("alibaba", false);
  const backend = a.remote.getMockImplementation();
  let credentialChecks = 0;
  a.remote.mockImplementation(request => {
    if (request.kind === "credentialStatus") {
      if (++credentialChecks <= 2) return Promise.reject(Error("mail_vault_unavailable"));
      return Promise.resolve({ enabled, configured: false });
    }
    if (request.kind === "cachedBody") return Promise.resolve({ summary, text: "Saved offline body" });
    return backend?.(request) ?? Promise.reject(Error("Missing fixture"));
  });
  const failure = "Windows credential storage is unavailable.";
  await screen.findByText(failure);
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Saved offline body");
  expect(screen.getByText(failure)).toBeTruthy();
  expect(screen.queryByText("System credentials are disabled in this profile.")).toBeNull();
  expect(screen.getByLabelText("Client password").matches(":disabled")).toBe(true);
  expect(button("Refresh from server").matches(":disabled")).toBe(true);

  const before = a.kinds().length;
  fireEvent.click(button("Retry"));
  await waitFor(() => expect(button("Retry").matches(":disabled")).toBe(false));
  expect(screen.getByText("Saved offline body")).toBeTruthy();
  expect(screen.getByText(failure)).toBeTruthy();
  fireEvent.click(button("Retry"));
  await waitFor(() => expect(screen.queryByText(failure)).toBeNull());
  expect(screen.getByText("Saved offline body")).toBeTruthy();
  expect(screen.getByLabelText("Client password").matches(":disabled")).toBe(!enabled);
  expect(Boolean(screen.queryByText("System credentials are disabled in this profile."))).toBe(!enabled);
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(button("Refresh from server").matches(":disabled")).toBe(true);
  expect(a.kinds().slice(before)).toEqual(["credentialStatus", "credentialStatus"]);
});

it("reads a cached body from the same IMAP folder and epoch after an inbox refresh", async () => {
  const a = setup("alibaba", true, 0, "Saved Archive body");
  const folder = await screen.findByLabelText("IMAP folder");
  await screen.findByText("Inbox fixture");
  fireEvent.change(folder, { target: { value: "Archive" } });
  await screen.findByText("Archive fixture");
  fireEvent.click(button("Refresh from server"));
  await screen.findByText("Showing messages retrieved from the server.");
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Saved Archive body");
  expect(a.remote).toHaveBeenCalledWith({
    kind: "cachedBody", accountId: "a", folder: "Archive", uidValidity: 7, uid: 30,
  });
  expect(a.kinds()).not.toContain("read");
});

it.each([false, true])("refreshes IMAP directories with the current folder present: %s", async present => {
  const a = setup("alibaba", true, 0, "Archive cached body");
  const backend = a.remote.getMockImplementation();
  a.remote.mockImplementation(request => request.kind === "folders"
    ? Promise.resolve(present ? [{ id: "Archive", name: "Archive" }] : [])
    : backend?.(request) ?? Promise.reject(Error("Missing fixture")));
  const folder = await screen.findByLabelText<HTMLSelectElement>("IMAP folder");
  await screen.findByRole("button", { name: /Inbox fixture/ });
  fireEvent.change(folder, { target: { value: "Archive" } });
  fireEvent.click(await screen.findByRole("button", { name: /Archive fixture/ }));
  await screen.findByText("Archive cached body");
  const before = a.remote.mock.calls.length;
  fireEvent.click(button("Refresh folder list"));
  await waitFor(() => expect(folder.matches(":disabled")).toBe(false));
  const cached = a.remote.mock.calls.slice(before).map(([r]) => r).filter(r => r.kind === "cachedPage");
  expect(a.kinds()).not.toContain("sync");
  expect(a.kinds()).not.toContain("read");
  if (present) {
    expect(folder.value).toBe("Archive");
    expect(screen.getByText("Archive cached body")).toBeTruthy();
    expect(cached).toEqual([]);
  } else {
    expect(folder.value).toBe("INBOX");
    expect(screen.queryByRole("article", { name: "Selected message" })).toBeNull();
    expect(screen.getByRole("button", { name: /Inbox fixture/ })).toBeTruthy();
    expect(cached).toEqual([{ kind: "cachedPage", accountId: "a", cursor: null, limit: 20 }]);
  }
});

it("retries an unreadable cached Alibaba message with its original folder and UID validity", async () => {
  const a = setup();
  const initial = a.remote.getMockImplementation();
  if (!initial) throw Error('Expected original transport fixture');
  let reads = 0;
  a.remote.mockImplementation(async request => {
    if (request.kind !== "cachedBody") return initial(request);
    if (reads++ === 0) throw Error("mail_storage");
    return { summary, text: "Recovered local IMAP body" };
  });
  await screen.findByText("Inbox fixture");
  fireEvent.change(screen.getByLabelText("IMAP folder"), { target: { value: "Archive" } });
  fireEvent.click(await screen.findByRole("button", { name: /Archive fixture/ }));
  const pane = () => within(screen.getByRole("article", { name: "Selected message" }));
  expect(await pane().findByRole("alert")).toHaveProperty("textContent", "Could not access local mail data.");
  expect(pane().queryByRole("button", { name: "Download message body" })).toBeNull();
  fireEvent.click(pane().getByRole("button", { name: "Try again" }));
  await pane().findByText("Recovered local IMAP body");
  const request = { kind: "cachedBody", accountId: "a", folder: "Archive", uidValidity: 7, uid: 30 };
  expect(a.remote.mock.calls.map(([r]) => r).filter(r => r.kind === "cachedBody" || r.kind === "read")).toEqual([request, request]);
  expect(screen.getByLabelText("IMAP folder")).toHaveProperty("value", "Archive");
});

it("drops the old Alibaba selection when the same UID appears in a new mailbox generation", async () => {
  const a = setup();
  const initial = a.remote.getMockImplementation();
  if (!initial) throw Error("Expected original transport fixture");
  a.remote.mockImplementation(async request => {
    if (request.kind === "cachedBody") throw Error("mail_storage");
    if (request.kind === "sync" && request.cursor) {
      return { uidValidity: 8, messages: [{ ...summary, subject: "New generation fixture" }], next: null };
    }
    return initial(request);
  });
  await screen.findByText("Inbox fixture");
  fireEvent.click(button("Refresh from server"));
  await screen.findByText("Showing messages retrieved from the server.");
  fireEvent.click(screen.getByRole("button", { name: /Inbox fixture/ }));
  await screen.findByRole("button", { name: "Try again" });
  fireEvent.click(button("Load older messages"));
  const replacement = await screen.findByRole("button", { name: /New generation fixture/ });
  expect(replacement).toHaveProperty("ariaPressed", "false");
  expect(screen.queryByRole("article", { name: "Selected message" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(a.remote.mock.calls.map(([r]) => r).filter(r => r.kind === "cachedBody")).toEqual([
    { kind: "cachedBody", accountId: "a", uidValidity: 7, uid: summary.uid },
  ]);
});

it("keeps the active IMAP message when another cached folder fails to open", async () => {
  setLocale("en");
  const accounts = [{ id: "a", provider: "alibaba", address: "local@example.test" }];
  const local = vi.fn(async (r: Record<string, unknown>) => {
    if (r.kind === "accounts") return accounts;
    if (r.kind === "drafts") return [];
    throw Error("Unexpected local operation");
  });
  const inbox = { uidValidity: 7, messages: [summary], next: null };
  const archive = { ...summary, subject: "Archive same UID" };
  let failFolder!: (reason: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { failFolder = reject; });
  let archiveReads = 0;
  const remote = vi.fn(async (r: Record<string, unknown>) => {
    if (r.kind === "credentialStatus") return { enabled: true, configured: true };
    if (r.kind === "cachedFolders") return ["Archive", "Empty", "Uncached"].map(id => ({ id, name: id }));
    if (r.kind === "cachedPage") {
      if (r.folder === "Archive") return ++archiveReads === 1 ? pending : { ...inbox, uidValidity: 9, messages: [archive] };
      if (r.folder === "Empty") return { ...inbox, messages: [] };
      if (r.folder === "Uncached") throw Error("mail_cache_empty");
      return inbox;
    }
    if (r.kind === "cachedBody") return r.folder === "Archive"
      ? { summary: archive, text: "Archive fixture body" }
      : { summary, text: "Original inbox body" };
    throw Error("Unexpected provider operation");
  });
  render(<Mail invoke={local as Invoke} transport={remote as Invoke}/>);
  const select = await screen.findByLabelText<HTMLSelectElement>("IMAP folder");
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Original inbox body");
  const set = (value: string) => fireEvent.change(select, { target: { value } });
  set("Archive");
  expect(select.value).toBe("INBOX");
  expect(screen.queryByText("Original inbox body")).toBeTruthy();
  await act(async () => failFolder(Error("mail_storage")));
  await screen.findByText("Could not access local mail data.");
  expect(select.value).toBe("INBOX");
  expect(screen.queryByText("Original inbox body")).toBeTruthy();

  set("Archive");
  fireEvent.click(await screen.findByRole("button", { name: /Archive same UID/ }));
  await screen.findByText("Archive fixture body");
  expect(select.value).toBe("Archive");
  expect(screen.queryByText("Original inbox body")).toBeNull();
  expect(remote.mock.calls.filter(([r]) => r.kind === "cachedBody").map(([r]) => r)).toEqual([
    { kind: "cachedBody", accountId: "a", uid: 30, uidValidity: 7 },
    { kind: "cachedBody", accountId: "a", folder: "Archive", uid: 30, uidValidity: 9 },
  ]);
  set("Empty");
  await screen.findByText("No messages on this page.");
  expect(select.value).toBe("Empty");
  expect(screen.queryByRole("article", { name: "Selected message" })).toBeNull();
  set("Uncached");
  await screen.findByText("No inbox has been saved on this device yet.");
  expect(select.value).toBe("Uncached");
  expect(remote.mock.calls.some(([r]) => ["read", "sync", "send", "replyDraft"].includes(String(r.kind)))).toBe(false);
});

const archivedCursor = { folder: "Archive", uidValidity: 7, before: summary.uid };
const replacementCursor = { folder: "Archive", uidValidity: 8, before: summary.uid };
const activeArchive = { ...summary, subject: "Archived generation seven" };
const replacementArchive = { ...summary, subject: "Archived generation eight" };

function offlineCursorFixture() {
  const a = setup();
  const initial = a.remote.getMockImplementation();
  if (!initial) throw Error("Missing transport fixture");
  let stale = false, report = "mail_inbox_changed", arrival = "ready";
  a.remote.mockImplementation(async request => {
    if (request.kind === "cachedPage" && request.folder === "Archive") {
      if (request.cursor && (request.cursor as typeof archivedCursor).uidValidity === 7) throw Error(report);
      if (request.cursor) {
        return { uidValidity: 8, messages: [{ ...summary, uid: 10, subject: "Older generation eight" }], next: null };
      }
      if (!stale) return { uidValidity: 7, messages: [activeArchive], next: archivedCursor };
      if (arrival !== "ready") throw Error(arrival);
      return { uidValidity: 8, messages: [replacementArchive], next: replacementCursor };
    }
    if (request.kind === "cachedBody" && request.folder === "Archive") {
      if (request.uidValidity === 7) {
        return { summary: activeArchive, text: "Old archive body", attachments: [{ id: 0, name: "old.bin", size: 8 }] };
      }
      return { summary: replacementArchive, text: "Current archive body" };
    }
    if (request.kind === "sync" && request.cursor) throw Error("mail_inbox_changed");
    return initial(request);
  });
  return {
    ...a,
    expire(error = "mail_inbox_changed", firstPage = "ready") { stale = true; report = error; arrival = firstPage; },
    pagesSince(start: number) {
      return a.remote.mock.calls.slice(start).map(([r]) => r).filter(r => r.kind === "cachedPage");
    },
  };
}

async function openOfflineArchive() {
  const a = offlineCursorFixture();
  await screen.findByText("Inbox fixture");
  fireEvent.change(screen.getByLabelText("IMAP folder"), { target: { value: "Archive" } });
  fireEvent.click(await screen.findByRole("button", { name: /Archived generation seven/ }));
  await screen.findByText("Old archive body");
  await screen.findByRole("button", { name: "Download attachment old.bin" });
  return a;
}

it("recovers an expired offline cursor from the same folder and discards the old message", async () => {
  const a = await openOfflineArchive();
  const start = a.remote.mock.calls.length;
  a.expire();
  fireEvent.click(button("Load older messages"));
  const replacement = await screen.findByRole("button", { name: /Archived generation eight/ });
  expect(screen.getByLabelText("IMAP folder")).toHaveProperty("value", "Archive");
  expect(replacement).toHaveProperty("ariaPressed", "false");
  expect(screen.queryByRole("article", { name: "Selected message" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Download attachment old.bin" })).toBeNull();
  expect(a.pagesSince(start)).toEqual([
    { kind: "cachedPage", accountId: "a", folder: "Archive", cursor: archivedCursor, limit: 20 },
    { kind: "cachedPage", accountId: "a", folder: "Archive", cursor: null, limit: 20 },
  ]);

  fireEvent.click(button("Load older messages"));
  await screen.findByRole("button", { name: /Older generation eight/ });
  expect(a.pagesSince(start).at(-1)).toMatchObject({ cursor: replacementCursor });
  fireEvent.click(replacement);
  await screen.findByText("Current archive body");
  expect(a.remote).toHaveBeenLastCalledWith({ kind: "cachedBody", accountId: "a", folder: "Archive", uid: summary.uid, uidValidity: 8 });
  expect(a.kinds()).not.toContain("sync");
  expect(a.kinds()).not.toContain("read");
});

it("shows the uncached state when the expired folder no longer has a local first page", async () => {
  const a = await openOfflineArchive();
  a.expire("mail_inbox_changed", "mail_cache_empty");
  fireEvent.click(button("Load older messages"));
  await screen.findByText("No inbox has been saved on this device yet.");
  expect(screen.getByLabelText("IMAP folder")).toHaveProperty("value", "Archive");
  expect(screen.queryByRole("article", { name: "Selected message" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Load older messages" })).toBeNull();
  expect(a.kinds()).not.toContain("sync");
});

it("preserves the cached reading and cursor after an ordinary offline pagination error", async () => {
  const a = await openOfflineArchive();
  const start = a.remote.mock.calls.length;
  a.expire("mail_storage");
  fireEvent.click(button("Load older messages"));
  await screen.findByText("Could not access local mail data.");
  expect(screen.getByText("Old archive body")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download attachment old.bin" })).toBeTruthy();
  expect(a.pagesSince(start)).toEqual([
    { kind: "cachedPage", accountId: "a", folder: "Archive", cursor: archivedCursor, limit: 20 },
  ]);
});

it("keeps an expired online cursor on the existing explicit refresh path", async () => {
  const a = offlineCursorFixture();
  await screen.findByText("Inbox fixture");
  fireEvent.click(button("Refresh from server"));
  await screen.findByText("Showing messages retrieved from the server.");
  const start = a.remote.mock.calls.length;
  fireEvent.click(button("Load older messages"));
  await screen.findByText("The inbox changed. Refresh it before continuing.");
  expect(screen.getByText("Showing messages retrieved from the server.")).toBeTruthy();
  expect(a.pagesSince(start)).toEqual([]);
});

it.each(["account", "folder"])("drops an expired-cursor recovery after changing the %s", async change => {
  setLocale("en");
  let stale = false, finish!: (value: unknown) => void;
  const recovering = new Promise<unknown>(resolve => { finish = resolve; });
  const remote = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "credentialStatus") return { enabled: true, configured: false };
    if (request.kind === "cachedFolders") return [{ id: "Archive", name: "Archive" }];
    if (request.kind === "cachedPage") {
      if (request.accountId === "b") return { uidValidity: 3, messages: [{ ...summary, subject: "Other account mail" }], next: null };
      if (request.cursor) throw Error("mail_inbox_changed");
      if (stale) return recovering;
      return { uidValidity: 7, messages: [activeArchive], next: archivedCursor };
    }
    throw Error("Unexpected provider request");
  });
  const props = {
    folder: "Archive", setFolder: vi.fn(), invoke: remote as Invoke, discard: () => true,
    onBusy: vi.fn(), onConfigured: vi.fn(), onReply: vi.fn(),
  };
  const view = render(<AlibabaInbox id="a" {...props}/>);
  await screen.findByText("Archived generation seven");
  stale = true;
  fireEvent.click(button("Load older messages"));
  await waitFor(() => expect(remote).toHaveBeenLastCalledWith({
    kind: "cachedPage", accountId: "a", folder: "Archive", cursor: null, limit: 20,
  }));
  if (change === "account") {
    view.rerender(<AlibabaInbox id="b" {...props}/>);
    await screen.findByText("Other account mail");
  } else {
    view.rerender(<AlibabaInbox id="a" {...props} folder="INBOX"/>);
  }
  await act(async () => finish({ uidValidity: 8, messages: [replacementArchive], next: null }));
  expect(screen.queryByText("Archived generation eight")).toBeNull();
  expect(props.setFolder).not.toHaveBeenCalled();
  if (change === "account") expect(screen.getByText("Other account mail")).toBeTruthy();
});

it.each([false, true])("retries only the local IMAP directory while preserving the current email (cached folders: %s)", async hasFolders => {
  const a = setup("alibaba", false);
  const backend = a.remote.getMockImplementation();
  if (!backend) throw Error("Missing transport fixture");
  let retries = 0;
  const cursor = { uidValidity: 7, before: summary.uid };
  a.remote.mockImplementation(async request => {
    if (request.kind === "cachedFolders") {
      if (retries < 2) throw Error("mail_storage");
      return hasFolders ? [{ id: "Archive", name: "Saved archive" }] : [];
    }
    if (request.kind === "cachedPage") {
      if (request.cursor) return { uidValidity: 7, messages: [{ ...summary, uid: 20, subject: "Earlier saved mail" }], next: null };
      return { uidValidity: 7, messages: [summary], next: cursor };
    }
    if (request.kind === "cachedBody") {
      return { summary, text: "Currently reading offline", attachments: [{ id: 0, name: "retained.pdf", size: 10 }] };
    }
    return backend(request);
  });
  const inbox = within(await screen.findByRole("region", { name: "Alibaba Mail inbox" }));
  const error = "Could not read saved IMAP folders.";
  await inbox.findByText(error);
  const retry = () => inbox.getByRole("button", { name: "Retry saved IMAP folders" });
  expect(inbox.getByRole("button", { name: "Refresh folder list" }).matches(":disabled")).toBe(true);

  fireEvent.click(await inbox.findByRole("button", { name: /Inbox fixture/ }));
  await inbox.findByText("Currently reading offline");
  fireEvent.change(inbox.getByLabelText("Client password"), { target: { value: "synthetic unsaved input" } });
  const before = a.remote.mock.calls.length;
  ++retries;
  await act(async () => fireEvent.click(retry()));
  expect(inbox.getByText(error)).toBeTruthy();
  expect(inbox.getByText("Currently reading offline")).toBeTruthy();

  ++retries;
  await act(async () => fireEvent.click(retry()));
  expect(inbox.queryByText(error)).toBeNull();
  expect(inbox.queryByRole("button", { name: "Retry saved IMAP folders" })).toBeNull();
  expect(inbox.getByText("Currently reading offline")).toBeTruthy();
  expect(inbox.getByRole("button", { name: "Download attachment retained.pdf" })).toBeTruthy();
  expect(inbox.getByLabelText("Client password")).toHaveProperty("value", "synthetic unsaved input");
  expect(inbox.getByLabelText("IMAP folder")).toHaveProperty("value", "INBOX");
  expect(Boolean(inbox.queryByRole("option", { name: "Saved archive" }))).toBe(hasFolders);
  expect(Boolean(inbox.queryByText("No additional IMAP folders are saved on this device."))).toBe(!hasFolders);
  expect(a.remote.mock.calls.slice(before).map(([request]) => request)).toEqual([
    { kind: "cachedFolders", accountId: "a" }, { kind: "cachedFolders", accountId: "a" },
  ]);
  fireEvent.click(inbox.getByRole("button", { name: "Load older messages" }));
  await inbox.findByRole("button", { name: /Earlier saved mail/ });
  expect(a.remote).toHaveBeenLastCalledWith({ kind: "cachedPage", accountId: "a", cursor, limit: 20 });
});

it("ignores a late saved directory response from a previous IMAP account", async () => {
  setLocale("en");
  let retry = false, finish!: (value: unknown) => void;
  const pending = new Promise<unknown>(resolve => { finish = resolve; });
  const remote = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "credentialStatus") return { enabled: false, configured: false };
    if (request.kind === "cachedPage") return { uidValidity: 7, messages: [summary], next: null };
    if (request.kind === "cachedFolders" && request.accountId === "b") return [{ id: "Other", name: "Other account folder" }];
    if (request.kind === "cachedFolders" && retry) return pending;
    throw Error("mail_storage");
  });
  const props = {
    folder: "INBOX", setFolder: vi.fn(), invoke: remote as Invoke, discard: () => true,
    onBusy: vi.fn(), onConfigured: vi.fn(), onReply: vi.fn(),
  };
  const view = render(<AlibabaInbox id="a" {...props}/>);
  const button = await screen.findByRole("button", { name: "Retry saved IMAP folders" });
  retry = true;
  fireEvent.click(button);
  expect(remote).toHaveBeenLastCalledWith({ kind: "cachedFolders", accountId: "a" });
  view.rerender(<AlibabaInbox id="b" {...props}/>);
  await screen.findByRole("option", { name: "Other account folder" });
  await act(async () => finish([{ id: "Old", name: "Old account folder" }]));
  expect(screen.queryByRole("option", { name: "Old account folder" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saved IMAP folders" })).toBeNull();
});
