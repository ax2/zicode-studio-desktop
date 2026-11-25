import {act,cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {Mail,type Invoke} from "./index";
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
  const remote=vi.fn(async (r:Record<string,unknown>)=>{
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
