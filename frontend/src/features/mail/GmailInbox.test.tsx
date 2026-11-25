import {act,cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {Mail,type Invoke} from "./index";
import {setLocale} from "../../shared/i18n";
type Input=Record<string,unknown>;
const account=(id:string)=>({id,provider:"gmail",address:id+"@example.test"});
const draft={id:"d",revision:4,recipient:"recipient@example.test",subject:"Saved subject",body:"Body checked before sending"};
const entry={id:"abc",from:"News <sender@example.test>",subject:"Inbox fixture",date:"today",snippet:"preview"};
afterEach(()=>{cleanup();vi.restoreAllMocks();setLocale("en")});
function fixture(remote:(r:Input)=>Promise<unknown>,accounts=[account("one")]){
  setLocale("en");
  const local=vi.fn(async(r:Input)=>r.kind==="accounts"?accounts:[draft]);
  const transport=vi.fn(remote);
  const view=render(<Mail invoke={local as Invoke} gmailTransport={transport as Invoke} transport={vi.fn(()=>{throw Error("Wrong provider")}) as Invoke}/>);
  return {...view,calls:transport};
}
it("starts from cache, requests separate read and send grants, and never sends without review",async()=>{
  let grant={connected:false,read:false,send:false},delivery:string|null=null;
  const view=fixture(async r=>{
    switch(r.kind){
      case "status":return grant;
      case "cachedPage":case "cachedBody":return null;
      case "connect":grant={connected:true,read:true,send:r.send===true};return grant;
      case "list":return r.cursor?{items:[{...entry,id:"ghi",subject:"Older fixture"}],nextCursor:null}:{items:[entry],nextCursor:"p2"};
      case "read":return {...entry,plainText:"<img src='https://invalid.test/tracker'>"};
      case "delivery":return delivery?{status:delivery}:null;
      case "send":expect(r).toEqual({kind:"send",accountId:"one",draftId:"d",revision:4,confirmed:true});delivery="unknown";return {status:delivery};
      default:throw Error("Unexpected request "+String(r.kind));
    }
  });
  const sign=await screen.findByRole("button",{name:"Sign in to read Gmail"});await waitFor(()=>expect(sign.matches(":disabled")).toBe(false));
  expect(view.calls.mock.calls.map(([r])=>r.kind)).toEqual(["cachedLabels","status","cachedPage","cachedLabels"]);
  fireEvent.click(sign);await screen.findByText("Gmail is connected for reading.");
  fireEvent.click(screen.getByRole("button",{name:"Refresh from server"}));fireEvent.click(await screen.findByRole("button",{name:/Inbox fixture/}));
  await screen.findByText("<img src='https://invalid.test/tracker'>");expect(view.container.querySelector("img")).toBe(null);
  fireEvent.click(screen.getByRole("button",{name:"Load older messages"}));await screen.findByText("Older fixture");
  fireEvent.click(screen.getByRole("button",{name:"Saved subject"}));await waitFor(()=>expect(view.calls.mock.calls.some(([r])=>r.kind==="delivery")).toBe(true));
  expect(screen.getByRole("button",{name:"Review before sending"}).matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Authorize sending with Gmail"}));await screen.findByText("Gmail is connected for reading and sending.");
  expect(view.calls.mock.calls.filter(([r])=>r.kind==="send")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button",{name:"Review before sending"}));await screen.findByText(draft.body,{selector:"pre"});
  expect(view.calls.mock.calls.filter(([r])=>r.kind==="send")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button",{name:"Confirm and send email"}));
  await screen.findByText(/Delivery is unknown. Check Gmail Sent/);expect(screen.queryByRole("button",{name:"Review before sending"})).toBe(null);
  fireEvent.click(screen.getByRole("button",{name:"New draft"}));fireEvent.click(screen.getByRole("button",{name:"Saved subject"}));
  await screen.findByText(/Delivery is unknown. Check Gmail Sent/);expect(view.calls.mock.calls.filter(([r])=>r.kind==="send")).toHaveLength(1);
});
it("opens a saved label offline and refreshes only that label on request",async()=>{
  const v=fixture(async r=>{
    if(r.kind==="status")return {connected:true,read:true};
    if(r.kind==="cachedLabels")return [{id:"Label_42",name:"Invoices"}];
    if(r.kind==="cachedPage")return {items:[r.label==="Label_42"?{...entry,subject:"Saved invoice"}:entry],nextCursor:null};
    if(r.kind==="list")return {items:[{...entry,subject:"Updated invoice"}],nextCursor:null};
    throw Error("Unexpected request");
  });
  await screen.findByText("Inbox fixture");
  fireEvent.change(screen.getByLabelText("Gmail label"),{target:{value:"Label_42"}});
  await screen.findByText("Saved invoice");
  expect(screen.queryByText("Inbox fixture")).toBe(null);
  expect(v.calls.mock.calls.some(([r])=>r.kind==="list")).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Refresh from server"}));
  await screen.findByText("Updated invoice");
  expect(v.calls).toHaveBeenCalledWith({kind:"list",accountId:"one",label:"Label_42",cursor:null,limit:20});
});
it("recovers an expired server page by refreshing the selected label",async()=>{
  let refreshes=0;
  fixture(async r=>{
    if(r.kind==="status")return {connected:true,read:true};
    if(r.kind==="cachedLabels")return [];
    if(r.kind==="cachedPage")return {items:[entry],nextCursor:null};
    if(r.kind==="list" && r.cursor)throw Error("gmail_page_expired");
    if(r.kind==="list")return {items:[{...entry,subject:"Refresh "+(++refreshes)}],nextCursor:"p2"};
    throw Error("Unexpected request");
  });
  await screen.findByText("Inbox fixture");
  const refresh=screen.getByRole("button",{name:"Refresh from server"});
  fireEvent.click(refresh);
  await screen.findByText("Refresh 1");
  fireEvent.click(screen.getByRole("button",{name:"Load older messages"}));
  await screen.findByText("This mail page expired. Refresh from the server to continue.");
  fireEvent.click(refresh);
  await screen.findByText("Refresh 2");
});
it("cancels browser authorization; a late successful result cannot grant sending",async()=>{
  let done:((v:unknown)=>void)|undefined;
  const v=fixture(async r=>{
    if(r.kind==="status")return {connected:false};
    if(r.kind==="cachedPage"||r.kind==="cancel")return null;
    if(r.kind==="connect")return new Promise(resolve=>{done=resolve});
    throw Error("unexpected");
  });
  const btn=await screen.findByRole("button",{name:"Sign in to read Gmail"});await waitFor(()=>expect(btn.matches(":disabled")).toBe(false));
  fireEvent.click(btn);fireEvent.click(await screen.findByRole("button",{name:"Cancel sign-in"}));
  await screen.findByText("Sign-in canceled.");await act(async()=>done?.({connected:true,read:true,send:true}));
  expect(screen.getByText("Gmail is not connected. Local drafts are still available.")).toBeTruthy();
  expect(v.calls.mock.calls.map(([r])=>r.kind)).not.toContain("send");
});
it("drops late message bodies from the previously selected account",async()=>{
  let finish:((v:unknown)=>void)|undefined;
  const v=fixture(async r=>{
    if(r.kind==="status")return {connected:true,read:true,send:false};
    if(r.kind==="cachedPage")return {items:r.accountId==="one"?[entry]:[],nextCursor:null};
    if(r.kind==="cachedBody")return new Promise(resolve=>{finish=resolve});
    throw Error("unexpected");
  },[account("one"),account("two")]);
  fireEvent.click(await screen.findByRole("button",{name:/Inbox fixture/}));
  fireEvent.change(screen.getByLabelText("Mail account"),{target:{value:"two"}});
  await screen.findByText("No messages on this page.");await act(async()=>finish?.({...entry,plainText:"OLD ACCOUNT CONTENT"}));
  expect(screen.queryByText("OLD ACCOUNT CONTENT")).toBe(null);
  expect(v.calls.mock.calls.every(([r])=>["cachedBody","cachedPage","status","cachedLabels"].includes(String(r.kind)))).toBe(true);
});

it("recovers an interrupted send from the local journal without posting it twice",async()=>{
  let claimed=false;
  const view=fixture(async r=>{
    if(r.kind==="status")return {connected:true,read:true,send:true};
    if(r.kind==="cachedPage")return null;
    if(r.kind==="delivery")return claimed?{status:"accepted",messageId:"fixture"}:null;
    if(r.kind==="send"){claimed=true;throw Error("lost desktop response")}
    throw Error("unexpected");
  });
  fireEvent.click(await screen.findByRole("button",{name:"Saved subject"}));
  const review=await screen.findByRole("button",{name:"Review before sending"});await waitFor(()=>expect(review.matches(":disabled")).toBe(false));
  fireEvent.click(review);fireEvent.click(screen.getByRole("button",{name:"Confirm and send email"}));
  await screen.findByText("The mail server accepted this message.");
  expect(view.calls.mock.calls.filter(([r])=>r.kind==="send")).toHaveLength(1);
});

it("keeps the Gmail grant when the desktop confirmation resolves to cancel",async()=>{
  const v=fixture(async r=>r.kind==="status"?{connected:true,read:true,send:true}:null);
  const button=await screen.findByRole("button",{name:"Disconnect Gmail"});
  vi.spyOn(window,"confirm").mockReturnValue(Promise.resolve(false) as unknown as boolean);
  await act(async()=>fireEvent.click(button));
  expect(v.calls.mock.calls.some(([r])=>r.kind==="disconnect")).toBe(false);
});
it("offers Gmail sign-out with cache retention by default and account-scoped removal on approval", async()=>{
  const confirm=vi.spyOn(window,"confirm").mockReturnValue(true);
  for(const clearCache of [false,true]){
    const mail=fixture(async r=>r.kind==="status"?{connected:true,read:true}:r.kind==="cachedPage"?{items:[entry]}:{revoked:true});
    const action=await screen.findByRole("button",{name:"Disconnect Gmail"});
    if(clearCache) fireEvent.click(screen.getByRole("checkbox",{name:"Clear cached messages for this account"}));
    fireEvent.click(action);
    await waitFor(()=>expect(mail.calls).toHaveBeenCalledWith({kind:"disconnect",accountId:"one",clearCache}));
    if(clearCache) expect(confirm).toHaveBeenCalledWith("Disconnect this account and clear its cached messages? Drafts and delivery records will be kept.");
    expect(Boolean(screen.queryByRole("button",{name:/Inbox fixture/}))).toBe(!clearCache);
    expect(screen.getByRole("button",{name:"Saved subject"})).toBeTruthy();
    mail.unmount();
  }
});

it.each(["disconnect", "reauthorize"])("continues the selected Gmail label from local pages after %s", async change => {
  const older = { ...entry, id: "older", subject: "Older stored message" };
  const localCursor = "offline:Label_42:10:abc";
  const v = fixture(async request => {
    switch (request.kind) {
      case "status": return { connected: true, read: true };
      case "cachedLabels": return [{ id: "Label_42", name: "Invoices" }];
      case "cachedPage":
        if (request.label !== "Label_42") return null;
        if (request.cursor === null) return { items: [entry], nextCursor: localCursor };
        if (request.cursor === localCursor) return { items: [older], nextCursor: null };
        throw Error("gmail_invalid");
      case "list":
        if (request.cursor) throw Error("gmail_reauthorize");
        return { items: [entry], nextCursor: "remote-token" };
      case "cachedBody": return { ...entry, plainText: "Keep this selected message" };
      case "disconnect": return { revoked: true };
      default: throw Error("Unexpected request " + request.kind);
    }
  });
  const label = await screen.findByLabelText("Gmail label");
  await waitFor(() => expect(label.matches(":disabled")).toBe(false));
  fireEvent.change(label, { target: { value: "Label_42" } });
  const refresh = screen.getByRole("button", { name: "Refresh from server" });
  await waitFor(() => expect(refresh.matches(":disabled")).toBe(false));
  fireEvent.click(refresh);
  await screen.findByText("Showing messages retrieved from the server.");
  fireEvent.click(screen.getByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Keep this selected message");
  if (change === "disconnect") {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Gmail" }));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
  }
  await screen.findByText("Gmail is not connected. Local drafts are still available.");
  const initialCalls = v.calls.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Load older messages" }));
  await screen.findByText("Older stored message");
  expect(screen.getAllByRole("button", { name: /Inbox fixture/ })).toHaveLength(1);
  expect(screen.getByText("Keep this selected message")).toBeTruthy();
  expect(screen.getByText("Showing messages saved on this device.")).toBeTruthy();
  expect((label as HTMLSelectElement).value).toBe("Label_42");
  expect(v.calls.mock.calls.slice(initialCalls).map(([request]) => request)).toEqual([
    { kind: "cachedPage", accountId: "one", label: "Label_42", cursor: null, limit: 20 },
    { kind: "cachedPage", accountId: "one", label: "Label_42", cursor: localCursor, limit: 20 },
  ]);
});

it("keeps the messages and dismisses unavailable pagination in a legacy offline Inbox", async () => {
  const v = fixture(async request => {
    if (request.kind === "status") return { connected: false };
    if (request.kind === "cachedLabels") return [];
    if (request.kind === "cachedPage") {
      return request.cursor ? null : { items: [entry], nextCursor: "legacy-saved-token" };
    }
    throw Error("Unexpected request " + request.kind);
  });
  fireEvent.click(await screen.findByRole("button", { name: "Load older messages" }));
  await screen.findByText("No older cached page is available.");
  expect(screen.queryByRole("button", { name: "Load older messages" })).toBeNull();
  expect(screen.getByRole("button", { name: /Inbox fixture/ })).toBeTruthy();
  expect(v.calls).toHaveBeenLastCalledWith({
    kind: "cachedPage", accountId: "one", label: "INBOX", cursor: "legacy-saved-token", limit: 20,
  });
});

it("reads the cached body of a refreshed Gmail row and downloads a body only when missing", async () => {
  const missing = { ...entry, id: "missing", subject: "Missing body fixture" };
  const v = fixture(async r => {
    if (r.kind === "status") return { connected: true, read: true };
    if (r.kind === "cachedPage") return null;
    if (r.kind === "cachedLabels") return [];
    if (r.kind === "list") return { items: [entry, missing], nextCursor: null };
    if (r.kind === "cachedBody") return r.id === entry.id ? { ...entry, plainText: "Read the saved Gmail body" } : null;
    if (r.kind === "read" && r.id === missing.id) return { ...missing, plainText: "Downloaded after cache miss" };
    throw Error("gmail_network");
  });
  const refresh = await screen.findByRole("button", { name: "Refresh from server" });
  await waitFor(() => expect(refresh.matches(":disabled")).toBe(false));
  fireEvent.click(refresh);
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Read the saved Gmail body");
  expect(v.calls).toHaveBeenCalledWith({ kind: "cachedBody", accountId: "one", id: entry.id });
  expect(v.calls.mock.calls.some(([r]) => r.kind === "read")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: /Missing body fixture/ }));
  await screen.findByText("Downloaded after cache miss");
  expect(v.calls.mock.calls.slice(-2).map(([r]) => r)).toEqual([
    { kind: "cachedBody", accountId: "one", id: missing.id },
    { kind: "read", accountId: "one", id: missing.id },
  ]);
});

it("does not download a Gmail cache miss after moving to another account", async () => {
  let finish!: (value: null) => void;
  const v = fixture(async r => {
    if (r.kind === "status") return { connected: true, read: true };
    if (r.kind === "cachedLabels") return [];
    if (r.kind === "cachedPage") return { items: [], nextCursor: null };
    if (r.kind === "list") return { items: [entry], nextCursor: null };
    if (r.kind === "cachedBody") return new Promise<null>(resolve => { finish = resolve; });
    if (r.kind === "read") return { ...entry, plainText: "Unexpected fetched body" };
    throw Error("unexpected operation");
  }, [account("one"), account("two")]);
  const refresh = await screen.findByRole("button", { name: "Refresh from server" });
  await waitFor(() => expect(refresh.matches(":disabled")).toBe(false));
  fireEvent.click(refresh);
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await waitFor(() => expect(typeof finish).toBe("function"));
  fireEvent.change(screen.getByLabelText("Mail account"), { target: { value: "two" } });
  await screen.findByText("two@example.test");
  await act(async () => finish(null));
  expect(v.calls.mock.calls.some(([r]) => r.kind === "read")).toBe(false);
  expect(screen.queryByText("Unexpected fetched body")).toBeNull();
});

it.each([false, true])("refreshes Gmail directories with the current label present: %s", async present => {
  const folder = { id: "Label_42", name: "Archived invoices" };
  const archived = { ...entry, id: "archive", subject: "Archived message" };
  const v = fixture(async request => {
    if (request.kind === "status") return { connected: true, read: true };
    if (request.kind === "cachedLabels") return [folder];
    if (request.kind === "labels") return present ? [folder] : [];
    if (request.kind === "cachedPage") return { items: [request.label === folder.id ? archived : entry], nextCursor: null };
    if (request.kind === "cachedBody") return { ...archived, plainText: "Archive cached body" };
    throw Error("Unexpected operation");
  });
  const label = await screen.findByLabelText<HTMLSelectElement>("Gmail label");
  await screen.findByRole("button", { name: /Inbox fixture/ });
  fireEvent.change(label, { target: { value: folder.id } });
  fireEvent.click(await screen.findByRole("button", { name: /Archived message/ }));
  await screen.findByText("Archive cached body");
  const before = v.calls.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh Gmail labels" }));
  await waitFor(() => expect(label.matches(":disabled")).toBe(false));
  const cached = v.calls.mock.calls.slice(before).map(([r]) => r).filter(r => r.kind === "cachedPage");
  expect(v.calls.mock.calls.some(([r]) => r.kind === "list" || r.kind === "read")).toBe(false);
  if (present) {
    expect(label.value).toBe(folder.id);
    expect(screen.getByText("Archive cached body")).toBeTruthy();
    expect(cached).toEqual([]);
  } else {
    expect(label.value).toBe("INBOX");
    expect(screen.queryByRole("article", { name: "Selected message" })).toBeNull();
    expect(screen.getByRole("button", { name: /Inbox fixture/ })).toBeTruthy();
    expect(cached).toEqual([{ kind: "cachedPage", accountId: "one", label: "INBOX", cursor: null, limit: 20 }]);
  }
});

it.each(["cancel", "denied", "moved"] as const)("keeps the Gmail authorization keyboard flow when %s", async outcome => {
  let deny!: (reason: Error) => void;
  const v = fixture(async request => {
    switch (request.kind) {
      case "status": return { connected: false };
      case "cachedPage": case "cachedLabels": case "cancel": return null;
      case "connect": return new Promise((_, reject) => { deny = reject; });
      default: throw Error("Unexpected Gmail request");
    }
  });
  const signIn = await screen.findByRole("button", { name: "Sign in to read Gmail" });
  await waitFor(() => expect(signIn.matches(":disabled")).toBe(false));
  signIn.focus();
  fireEvent.click(signIn);
  const stop = await screen.findByRole("button", { name: "Cancel sign-in" });
  expect(document.activeElement).toBe(stop);

  const address = screen.getByRole("textbox", { name: "Email address" });
  if (outcome === "cancel") {
    fireEvent.click(stop);
    await screen.findByText("Sign-in canceled.");
  } else {
    if (outcome === "moved") address.focus();
    await act(async () => deny(Error("gmail_authorization_denied")));
    await screen.findByText("Google authorization was declined. Your drafts are unchanged.");
  }
  expect(signIn.matches(":disabled")).toBe(false);
  expect(document.activeElement).toBe(outcome === "moved" ? address : signIn);
  expect(v.calls.mock.calls.some(([request]) => request.kind === "send")).toBe(false);
  if (outcome !== "moved") {
    fireEvent.click(signIn);
    await screen.findByRole("button", { name: "Cancel sign-in" });
    expect(v.calls.mock.calls.filter(([request]) => request.kind === "connect")).toHaveLength(2);
  }
});

it("moves focus to Reconnect when the first Gmail authorization succeeds", async () => {
  let approve!: (grant: { connected: boolean; read: boolean; send: boolean }) => void;
  fixture(async request => {
    if (request.kind === "status") return { connected: false };
    if (request.kind === "cachedPage" || request.kind === "cachedLabels") return null;
    if (request.kind === "connect") return new Promise(resolve => { approve = resolve; });
    throw Error("Unexpected Gmail request");
  });
  const signIn = await screen.findByRole("button", { name: "Sign in to read Gmail" });
  await waitFor(() => expect(signIn.matches(":disabled")).toBe(false));
  signIn.focus();
  fireEvent.click(signIn);
  const stop = await screen.findByRole("button", { name: "Cancel sign-in" });
  expect(document.activeElement).toBe(stop);
  await act(async () => approve({ connected: true, read: true, send: false }));
  expect(document.activeElement).toBe(await screen.findByRole("button", { name: "Reconnect Gmail" }));
});

it.each([true, false])("retries a local body error without remote fallback, cache recovered=%s", async recovered => {
  let reads = 0;
  const v = fixture(async r => {
    if (r.kind === "status") return { connected: true, read: true };
    if (r.kind === "cachedLabels") return [];
    if (r.kind === "cachedPage" || r.kind === "list") return { items: [entry], nextCursor: null };
    if (r.kind === "cachedBody") {
      if (reads++ === 0) throw Error("mail_storage");
      return recovered ? { ...entry, plainText: "Recovered local Gmail body" } : null;
    }
    if (r.kind === "read") return { ...entry, plainText: "Explicit Gmail download" };
    throw Error("Unexpected request");
  });
  await screen.findByRole("button", { name: /Inbox fixture/ });
  fireEvent.click(screen.getByRole("button", { name: "Refresh from server" }));
  await screen.findByText("Showing messages retrieved from the server.");
  fireEvent.click(screen.getByRole("button", { name: /Inbox fixture/ }));
  const pane = () => within(screen.getByRole("article", { name: "Selected message" }));
  expect(await pane().findByRole("alert")).toHaveProperty("textContent", "Could not access local mail data.");
  expect(pane().queryByRole("button", { name: "Download message body" })).toBeNull();
  fireEvent.click(pane().getByRole("button", { name: "Try again" }));
  if (recovered) await pane().findByText("Recovered local Gmail body");
  else await pane().findByText(/not available offline/);
  const readsAtRetry = v.calls.mock.calls.map(([r]) => r).filter(r => r.kind === "cachedBody" || r.kind === "read");
  const request = { kind: "cachedBody", accountId: "one", id: entry.id };
  expect(readsAtRetry).toEqual([request, request]);
  if (!recovered) {
    fireEvent.click(pane().getByRole("button", { name: "Download message body" }));
    await pane().findByText("Explicit Gmail download");
    expect(v.calls).toHaveBeenLastCalledWith({ kind: "read", accountId: "one", id: entry.id });
  }
});

it("does not show a late retry after changing the active Gmail account", async () => {
  let reads = 0;
  let finish!: (value: unknown) => void;
  const v = fixture(async r => {
    if (r.kind === "status") return { connected: false };
    if (r.kind === "cachedLabels") return [];
    if (r.kind === "cachedPage") return r.accountId === "one" ? { items: [entry], nextCursor: null } : null;
    if (r.kind === "cachedBody") {
      if (reads++ === 0) throw Error("mail_storage");
      return new Promise(resolve => { finish = resolve; });
    }
    throw Error("Unexpected request");
  }, [account("one"), account("two")]);
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await act(async () => fireEvent.change(screen.getByLabelText(/^Mail account/), { target: { value: "two" } }));
  await screen.findByText("two@example.test");
  await act(async () => finish({ ...entry, plainText: "Old Gmail account body" }));
  expect(screen.queryByText("Old Gmail account body")).toBeNull();
  expect(screen.queryByRole("article", { name: "Selected message" })).toBeNull();
  expect(v.calls.mock.calls.map(([r]) => r).filter(r => r.kind === "cachedBody" || r.kind === "read")).toEqual(
    Array.from({ length: 2 }, () => ({ kind: "cachedBody", accountId: "one", id: entry.id })),
  );
});
