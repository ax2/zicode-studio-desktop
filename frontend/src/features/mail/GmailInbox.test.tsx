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

it("keeps an old stored Gmail connection available for disconnect but requires current authorization for server access", async () => {
  const { calls } = fixture(async request => {
    if (request.kind === "status") return { connected: true, read: false, send: false, needsReconnect: true };
    if (request.kind === "cachedLabels") return [];
    if (request.kind === "cachedPage") return { items: [entry], nextCursor: null };
    if (request.kind === "cachedBody") return { ...entry, plainText: "Cached message with old authorization" };
    if (request.kind === "delivery") return null;
    if (request.kind === "connect") return { connected: true, read: true, send: request.send === true };
    throw Error("Unexpected Gmail request");
  });
  await screen.findByText("Reconnect Gmail with the permission needed for this action.");
  expect(screen.getByRole("button", { name: "Refresh from server" }).matches(":disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Disconnect Gmail" }).matches(":disabled")).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Cached message with old authorization");
  fireEvent.click(screen.getByRole("button", { name: "Saved subject" }));
  const review = await screen.findByRole("button", { name: "Review before sending" });
  expect(review.matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reconnect Gmail" }));
  await screen.findByText("Gmail is connected for reading.");
  expect(review.matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Authorize sending with Gmail" }));
  await screen.findByText("Gmail is connected for reading and sending.");
  expect(review.matches(":disabled")).toBe(false);
  expect(screen.getByText("Cached message with old authorization")).toBeTruthy();
  expect(calls.mock.calls.filter(([request]) => request.kind === "connect").map(([request]) => request.send)).toEqual([false, true]);
  expect(calls.mock.calls.some(([request]) => request.kind === "send" || request.kind === "disconnect")).toBe(false);
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
it.each([false, true])("retries an unavailable local Gmail label directory while reading offline (empty: %s)", async empty => {
  let directoryAvailable = false;
  const calls = fixture(async request => {
    if (request.kind === "status") return { connected: false };
    if (request.kind === "cachedLabels") {
      if (!directoryAvailable) throw Error("gmail_storage");
      return empty ? null : [{ id: "Archive", name: "Archive" }];
    }
    if (request.kind === "cachedPage") return { items: [entry], nextCursor: "saved-page" };
    if (request.kind === "cachedBody") return { ...entry, plainText: "Saved inbox body" };
    throw Error("Unexpected Gmail request");
  }).calls;
  const inbox = within(await screen.findByRole("region", { name: "Gmail inbox" }));
  await inbox.findByText("Could not read saved Gmail labels.");
  fireEvent.click(await inbox.findByRole("button", { name: /Inbox fixture/ }));
  await inbox.findByText("Saved inbox body");
  const retry = inbox.getByRole("button", { name: "Retry saved Gmail labels" });
  const refresh = inbox.getByRole("button", { name: "Refresh Gmail labels" });
  expect(refresh.matches(":disabled")).toBe(true);

  calls.mockClear();
  fireEvent.click(retry);
  await waitFor(() => expect(retry.matches(":disabled")).toBe(false));
  expect(inbox.getByText("Could not read saved Gmail labels.")).toBeTruthy();
  expect(inbox.getByText("Saved inbox body")).toBeTruthy();

  directoryAvailable = true;
  fireEvent.click(retry);
  await waitFor(() => expect(inbox.queryByRole("button", { name: "Retry saved Gmail labels" })).toBeNull());
  expect(inbox.queryByText("Could not read saved Gmail labels.")).toBeNull();
  const label = inbox.getByLabelText<HTMLSelectElement>("Gmail label");
  expect([...label.options].map(option => option.value)).toEqual(empty ? ["INBOX"] : ["INBOX", "Archive"]);
  expect(label.value).toBe("INBOX");
  expect(inbox.getByText("Saved inbox body")).toBeTruthy();
  expect(inbox.getByRole("button", { name: "Load older messages" })).toBeTruthy();
  expect(refresh.matches(":disabled")).toBe(true);
  expect(calls.mock.calls.map(([request]) => request)).toEqual([
    { kind: "cachedLabels", accountId: "one" }, { kind: "cachedLabels", accountId: "one" },
  ]);
});

it("drops a saved Gmail label retry that finishes after an account switch", async () => {
  let beginRetry = false, finishRetry!: (value: unknown) => void;
  const pending = new Promise(resolve => { finishRetry = resolve; });
  const second = { ...entry, subject: "Other account message" };
  const view = fixture(async request => {
    if (request.kind === "status") return { connected: false };
    if (request.kind === "cachedLabels") {
      if (request.accountId === "two") return [{ id: "Other", name: "Other label" }];
      if (beginRetry) return pending;
      throw Error("gmail_storage");
    }
    if (request.kind === "cachedPage") return { items: [request.accountId === "two" ? second : entry], nextCursor: null };
    if (request.kind === "cachedBody") return { ...second, plainText: "Other account body" };
    throw Error("Unexpected Gmail request");
  }, [account("one"), account("two")]);
  const retry = await screen.findByRole("button", { name: "Retry saved Gmail labels" });
  beginRetry = true;
  view.calls.mockClear();
  fireEvent.click(retry);
  expect(view.calls).toHaveBeenCalledWith({ kind: "cachedLabels", accountId: "one" });
  fireEvent.change(screen.getByLabelText("Mail account"), { target: { value: "two" } });
  fireEvent.click(await screen.findByRole("button", { name: /Other account message/ }));
  await screen.findByText("Other account body");
  await act(async () => finishRetry([{ id: "Late", name: "Late label from first account" }]));
  const label = screen.getByLabelText<HTMLSelectElement>("Gmail label");
  expect([...label.options].map(option => option.value)).toEqual(["INBOX", "Other"]);
  expect(screen.getByText("Other account body")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry saved Gmail labels" })).toBeNull();
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
it("keeps reading the same Gmail message when its label refresh succeeds", async () => {
  const updated = { ...entry, subject: "Current message after refresh" };
  let removed = false;
  const { calls } = fixture(async request => {
    if (request.kind === "status") return { connected: true, read: true };
    if (request.kind === "cachedLabels") return [{ id: "Archive", name: "Archive" }];
    if (request.kind === "cachedPage") return { items: [entry], nextCursor: null };
    if (request.kind === "cachedBody") return { ...entry, plainText: "Keep reading this body" };
    if (request.kind === "list") {
      expect(request.label).toBe("INBOX");
      return { items: removed ? [{ ...entry, id: "other", subject: "Another message" }] : [updated], nextCursor: null };
    }
    throw Error("Unexpected request");
  });
  const inbox = within(await screen.findByRole("region", { name: "Gmail inbox" }));
  fireEvent.click(await inbox.findByRole("button", { name: /Inbox fixture/ }));
  await inbox.findByText("Keep reading this body");

  const refresh = inbox.getByRole("button", { name: "Refresh from server" });
  fireEvent.click(refresh);
  const row = await inbox.findByRole("button", { name: /Current message after refresh/ });
  expect(row.getAttribute("aria-pressed")).toBe("true");
  const reading = within(inbox.getByRole("article", { name: "Selected message" }));
  expect(reading.getByRole("heading", { name: updated.subject })).toBeTruthy();
  expect(reading.getByText("Keep reading this body")).toBeTruthy();
  expect(calls.mock.calls.filter(([request]) => request.kind === "cachedBody")).toHaveLength(1);

  removed = true;
  fireEvent.click(refresh);
  await inbox.findByRole("button", { name: /Another message/ });
  expect(inbox.queryByRole("article", { name: "Selected message" })).toBeNull();
});

it("clears Gmail reading when switching labels even when the message ID is shared", async () => {
  fixture(async request => {
    if (request.kind === "status") return { connected: false };
    if (request.kind === "cachedLabels") return [{ id: "Archive", name: "Archive" }];
    if (request.kind === "cachedPage") {
      return { items: [{ ...entry, subject: request.label === "Archive" ? "Shared message in Archive" : entry.subject }], nextCursor: null };
    }
    if (request.kind === "cachedBody") return { ...entry, plainText: "Previous label body" };
    throw Error("Unexpected request");
  });
  const inbox = within(await screen.findByRole("region", { name: "Gmail inbox" }));
  fireEvent.click(await inbox.findByRole("button", { name: /Inbox fixture/ }));
  await inbox.findByText("Previous label body");
  fireEvent.change(inbox.getByLabelText("Gmail label"), { target: { value: "Archive" } });
  await inbox.findByRole("button", { name: /Shared message in Archive/ });
  expect(inbox.queryByRole("article", { name: "Selected message" })).toBeNull();
});

it("refreshes the selected Gmail label at the expired pagination action", async () => {
  const labelId = "Label_Work";
  const message = { ...entry, subject: "Current project mail" };
  let initialPages = 0;
  const { calls } = fixture(async request => {
    if (request.kind === "status") return { connected: true, read: true };
    if (request.kind === "cachedLabels") return [{ id: labelId, name: "Projects" }];
    if (request.kind === "cachedPage") return { items: [entry], nextCursor: null };
    if (request.kind === "cachedBody") return { ...message, plainText: "Current cached body" };
    if (request.kind === "list") {
      expect(request.label).toBe(labelId);
      if (request.cursor === "expired-token") throw Error("gmail_page_expired");
      if (request.cursor === "fresh-token") {
        return { items: [{ ...message, id: "older", subject: "Older project mail" }], nextCursor: null };
      }
      if (++initialPages === 2) throw Error("gmail_rate_limited");
      return { items: [message], nextCursor: initialPages === 1 ? "expired-token" : "fresh-token" };
    }
    throw Error("Unexpected request");
  });
  const inbox = within(await screen.findByRole("region", { name: "Gmail inbox" }));
  await inbox.findByRole("option", { name: "Projects" });
  const label = inbox.getByLabelText<HTMLSelectElement>("Gmail label");
  fireEvent.change(label, { target: { value: labelId } });
  await waitFor(() => expect(label.value).toBe(labelId));
  fireEvent.click(inbox.getByRole("button", { name: "Refresh from server" }));
  fireEvent.click(await inbox.findByRole("button", { name: /Current project mail/ }));
  await inbox.findByText("Current cached body");

  fireEvent.click(inbox.getByRole("button", { name: "Load older messages" }));
  await inbox.findByText("This mail page expired. Refresh from the server to continue.");
  const recover = inbox.getByRole("button", { name: "Refresh this Gmail label" });
  expect(inbox.queryByRole("button", { name: "Load older messages" })).toBeNull();
  expect(inbox.getByText("Current cached body")).toBeTruthy();
  expect(calls.mock.calls.filter(([request]) => request.kind === "list").map(([request]) => request.cursor))
    .toEqual([null, "expired-token"]);

  fireEvent.click(recover);
  await inbox.findByText("Google has limited requests. Try again later.");
  expect(inbox.getByText("Current cached body")).toBeTruthy();
  expect(label.value).toBe(labelId);
  fireEvent.click(recover);

  fireEvent.click(await inbox.findByRole("button", { name: "Load older messages" }));
  await inbox.findByRole("button", { name: /Older project mail/ });
  expect(calls.mock.calls.filter(([request]) => request.kind === "list").map(([request]) => [request.label, request.cursor]))
    .toEqual([[labelId, null], [labelId, "expired-token"], [labelId, null], [labelId, null], [labelId, "fresh-token"]]);
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

it("keeps the current Gmail label and cached body when another label read fails", async () => {
  const archived = { ...entry, id: "archive", subject: "Archive cached message" };
  let archiveReads = 0;
  let failLabel!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { failLabel = reject; });
  const view = fixture(async request => {
    if (request.kind === "status") return { connected: true, read: true };
    if (request.kind === "cachedLabels") return ["Archive", "Empty", "Uncached"].map(id => ({ id, name: id }));
    if (request.kind === "cachedPage") {
      if (request.label === "Archive") return ++archiveReads === 1 ? pending : { items: [archived], nextCursor: null };
      if (request.label === "Empty") return { items: [], nextCursor: null };
      if (request.label === "Uncached") return null;
      return { items: [entry], nextCursor: null };
    }
    if (request.kind === "cachedBody") return request.id === archived.id
      ? { ...archived, plainText: "Archive cached body" }
      : { ...entry, plainText: "Original cached body" };
    throw Error("Unexpected Gmail request");
  });
  const label = await screen.findByLabelText<HTMLSelectElement>("Gmail label");
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Original cached body");
  const setLabel = (value: string) => fireEvent.change(label, { target: { value } });
  setLabel("Archive");
  expect(label.value).toBe("INBOX");
  expect(screen.queryByText("Original cached body")).toBeTruthy();
  await act(async () => failLabel(Error("gmail_storage")));
  await screen.findByText("Could not access local mail data.");
  expect(label.value).toBe("INBOX");
  expect(screen.queryByText("Original cached body")).toBeTruthy();

  setLabel("Archive");
  fireEvent.click(await screen.findByRole("button", { name: /Archive cached message/ }));
  await screen.findByText("Archive cached body");
  expect(label.value).toBe("Archive");
  expect(screen.queryByText("Original cached body")).toBeNull();
  setLabel("Empty");
  await screen.findByText("No messages on this page.");
  expect(label.value).toBe("Empty");
  expect(screen.queryByRole("article", { name: "Selected message" })).toBeNull();
  setLabel("Uncached");
  await screen.findByText("No inbox has been saved on this device yet.");
  expect(label.value).toBe("Uncached");
  expect(view.calls.mock.calls.some(([request]) => ["list", "read", "replyDraft", "send"].includes(String(request.kind)))).toBe(false);
});

it("drops a pending Gmail label page after switching to another account", async () => {
  let finishLabel!: (value: unknown) => void;
  const pending = new Promise(resolve => { finishLabel = resolve; });
  const other = { ...entry, subject: "Other account message" };
  const view = fixture(async request => {
    if (request.kind === "status") return { connected: true, read: true };
    if (request.kind === "cachedLabels") return request.accountId === "one" ? [{ id: "Archive", name: "Archive" }] : [];
    if (request.kind === "cachedPage") {
      if (request.accountId === "two") return { items: [other], nextCursor: null };
      return request.label === "Archive" ? pending : { items: [entry], nextCursor: null };
    }
    throw Error("Unexpected Gmail request");
  }, [account("one"), account("two")]);
  await screen.findByText("Inbox fixture");
  fireEvent.change(screen.getByLabelText("Gmail label"), { target: { value: "Archive" } });
  expect(view.calls).toHaveBeenCalledWith({ kind: "cachedPage", accountId: "one", label: "Archive", cursor: null, limit: 20 });
  fireEvent.change(screen.getByLabelText("Mail account"), { target: { value: "two" } });
  await screen.findByText("Other account message");
  await act(async () => finishLabel({ items: [{ ...entry, subject: "Stale archive result" }], nextCursor: null }));
  expect(screen.queryByText("Stale archive result")).toBeNull();
  expect(screen.getByLabelText<HTMLSelectElement>("Gmail label").value).toBe("INBOX");
  expect(screen.getByLabelText<HTMLSelectElement>("Mail account").value).toBe("two");
});


it("cancels a held Gmail refresh, restores keyboard focus, and ignores the late page", async () => {
  let resolvePrevious!: (page: unknown) => void;
  let refreshes = 0;
  const previousPage = new Promise(resolve => { resolvePrevious = resolve; });
  const view = fixture(async request => {
    switch (request.kind) {
      case "status": return { connected: true, read: true };
      case "cachedLabels": return [];
      case "cachedPage": return { items: [entry], nextCursor: null };
      case "cachedBody": return { ...entry, plainText: "Body saved on this device" };
      case "cancel": return null;
      case "list": return ++refreshes === 1
        ? previousPage
        : { items: [{ ...entry, subject: "Fresh subject" }], nextCursor: null };
      default: throw Error("Unexpected Gmail request");
    }
  });
  fireEvent.click(await screen.findByRole("button", { name: /Inbox fixture/ }));
  await screen.findByText("Body saved on this device");
  const refresh = screen.getByRole("button", { name: "Refresh from server" });
  refresh.focus();
  fireEvent.click(refresh);
  const cancel = await screen.findByRole("button", { name: "Cancel Gmail refresh" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.click(cancel);
  await screen.findByText("Gmail refresh canceled.");
  expect(document.activeElement).toBe(refresh);
  expect(screen.getByText("Body saved on this device")).toBeTruthy();
  expect(view.calls).toHaveBeenCalledWith({ kind: "cancel", accountId: "one" });
  fireEvent.click(refresh);
  await screen.findByRole("button", { name: /Fresh subject/ });
  await act(async () => resolvePrevious({ items: [{ ...entry, subject: "Late subject" }], nextCursor: null }));
  expect(screen.queryByText("Late subject")).toBeNull();
  expect(screen.getByText("Body saved on this device")).toBeTruthy();
});
