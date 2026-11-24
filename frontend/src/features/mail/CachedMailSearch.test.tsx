import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CachedMailSearch } from "./CachedMailSearch";
import { setLocale } from "../../shared/i18n";
import type { Invoke } from "./index";

afterEach(cleanup);
it("limits offline searches to the selected label and retains the query when switching labels",async()=>{
  setLocale("en");
  const accounts=[{id:"a",address:"first@example.test",provider:"gmail"}];
  const local=vi.fn(async()=>({items:[],more:false}));
  const view=(label:string)=><CachedMailSearch accounts={accounts} current="a" label={label} invoke={local as Invoke}/>;
  const rendered=render(view("Label_42"));
  fireEvent.click(screen.getByLabelText("Search only the selected Gmail label"));
  fireEvent.change(screen.getByLabelText("Search cached mail"),{target:{value:"invoice"}});
  fireEvent.click(screen.getByRole("button",{name:"Search"}));
  await screen.findByText("No matching cached messages.");
  expect(local).toHaveBeenCalledWith({kind:"search",account:"a",label:"Label_42",query:"invoice",offset:0});
  rendered.rerender(view("INBOX"));
  expect(screen.queryByText("No matching cached messages.")).toBeNull();
  expect(screen.getByDisplayValue("invoice")).toBeTruthy();
});
it("opens an identically numbered result through its owning account without requesting mail from a server", async () => {
  setLocale("en");
  const accounts = [
    {id:"a",address:"first@example.test",provider:"alibaba"},
    {id:"b",address:"second@example.test",provider:"gmail"},
  ];
  const local = vi.fn(async () => ({items:accounts.map(a=>({account:a.id,address:a.address,provider:a.provider,id:"42",epoch:a.id==="a"?7:null,subject:"Shared subject",sender:a.address})),more:false}));
  const gmail = vi.fn(async()=>({plainText:"Gmail offline fixture"}));
  const ali = vi.fn(async()=>({text:"Alibaba offline fixture"}));
  render(<CachedMailSearch accounts={accounts} current="a" invoke={local as Invoke} gmail={gmail as Invoke} alibaba={ali as Invoke}/>);
  expect((screen.getByLabelText("Search scope") as HTMLSelectElement).value).toBe("a");
  fireEvent.change(screen.getByLabelText("Search scope"),{target:{value:""}});
  fireEvent.change(screen.getByLabelText("Search cached mail"),{target:{value:"fixture"}});
  fireEvent.click(screen.getByRole("button",{name:"Search"}));
  const hits=await screen.findAllByRole("button",{name:/Shared subject/});
  expect(local).toHaveBeenCalledWith({kind:"search",account:null,query:"fixture",offset:0});
  fireEvent.click(hits[1]);
  await screen.findByText("Gmail offline fixture");
  expect(gmail).toHaveBeenCalledWith({kind:"cachedBody",accountId:"b",id:"42"});
  fireEvent.click(hits[0]);
  await screen.findByText("Alibaba offline fixture");
  expect(ali).toHaveBeenCalledWith({kind:"cachedBody",accountId:"a",uidValidity:7,uid:42});
  expect(screen.queryByText("Gmail offline fixture")).toBeNull();
  fireEvent.change(screen.getByLabelText("Search scope"),{target:{value:"b"}});
  expect(screen.queryByText("Alibaba offline fixture")).toBeNull();
});

it.each(["studio-mail-cache-cleared","studio-mail-cache-updated"])("refreshes changed account results and rejects a late body after %s",async(event)=>{
  setLocale("en");
  const accounts=[{id:"a",address:"first@example.test",provider:"gmail"},{id:"b",address:"second@example.test",provider:"gmail"}];
  const items=accounts.map(a=>({account:a.id,address:a.address,provider:"gmail",id:"42",epoch:null,subject:a.address,sender:"synthetic"}));
  const invoke=vi.fn().mockResolvedValueOnce({items,more:true}).mockResolvedValueOnce({items:items.slice(1),more:false});
  let finish:(value:unknown)=>void=()=>{};
  const gmail=vi.fn(()=>new Promise(resolve=>{finish=resolve}));
  render(<CachedMailSearch accounts={accounts} current="a" invoke={invoke as Invoke} gmail={gmail as Invoke}/>);
  fireEvent.change(screen.getByLabelText("Search scope"),{target:{value:""}});
  fireEvent.change(screen.getByLabelText("Search cached mail"),{target:{value:"fixture"}});
  fireEvent.click(screen.getByRole("button",{name:"Search"}));
  fireEvent.click(await screen.findByRole("button",{name:/first@example/}));
  await act(async()=>window.dispatchEvent(new CustomEvent(event,{detail:"a"})));
  expect(screen.queryByRole("button",{name:/first@example/})).toBeNull();
  expect(screen.queryByRole("button",{name:/second@example/})).toBeTruthy();
  await act(async()=>finish({plainText:"stale content"}));
  expect(screen.queryByText("stale content")).toBeNull();
  expect(screen.queryByRole("article")).toBeNull();
  expect(screen.queryByRole("button",{name:"Next"})).toBeNull();
});

function beginAllAccountSearch(invoke: Invoke, gmail: Invoke) {
  setLocale("en");
  const accounts = [
    { id: "a", address: "first@example.test", provider: "gmail" },
    { id: "b", address: "second@example.test", provider: "gmail" },
  ];
  render(<CachedMailSearch accounts={accounts} current="a" invoke={invoke} gmail={gmail} />);
  fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

const firstHit = { account: "a", address: "first@example.test", provider: "gmail", id: "42", epoch: null, subject: "First fixture", sender: "Example" };
const secondHit = { ...firstHit, account: "b", address: "second@example.test", subject: "Second fixture" };

it.each([
  ["studio-mail-cache-updated", "a", [firstHit, secondHit]],
  ["studio-mail-cache-updated", "b", [firstHit, secondHit]],
  ["studio-mail-cache-cleared", "b", [firstHit]],
] as const)("keeps the pending body when %s for account %s leaves that message available", async (event, account, items) => {
  const invoke = vi.fn().mockResolvedValueOnce({ items: [firstHit, secondHit], more: false }).mockResolvedValueOnce({ items, more: false });
  let finish!: (body: { plainText: string }) => void;
  const gmail = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /First fixture/ }));
  await act(async () => window.dispatchEvent(new CustomEvent(event, { detail: account })));
  await act(async () => finish({ plainText: "Pending body from the first account" }));
  expect(screen.getByText("Pending body from the first account")).toBeTruthy();
  expect(gmail).toHaveBeenCalledExactlyOnceWith({ kind: "cachedBody", accountId: "a", id: "42" });
});

it("checks the selected message against the latest refresh when two accounts update together", async () => {
  const replies: Array<(page: unknown) => void> = [];
  const invoke = vi.fn().mockResolvedValueOnce({ items: [firstHit, secondHit], more: false })
    .mockImplementation(() => new Promise(resolve => { replies.push(resolve); }));
  let finish!: (body: { plainText: string }) => void;
  const gmail = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /First fixture/ }));
  await act(async () => {
    window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "a" }));
    window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "b" }));
  });
  await act(async () => replies[1]({ items: [secondHit], more: false }));
  await act(async () => replies[0]({ items: [firstHit, secondHit], more: false }));
  await act(async () => finish({ plainText: "Old message must stay closed" }));
  expect(screen.queryByRole("article")).toBeNull();
  expect(screen.queryByRole("button", { name: /First fixture/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Second fixture/ })).toBeTruthy();
});

it("closes an old IMAP body when a refresh replaces the same message number with a new UID validity", async () => {
  setLocale("en");
  const account = { id: "a", address: "first@example.test", provider: "alibaba" };
  const oldHit = { ...firstHit, provider: account.provider, folder: "INBOX", epoch: 7 };
  const newHit = { ...oldHit, epoch: 8 };
  const invoke = vi.fn().mockResolvedValueOnce({ items: [oldHit], more: false }).mockResolvedValueOnce({ items: [newHit], more: false });
  let finish!: (body: { text: string }) => void;
  const alibaba = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  render(<CachedMailSearch accounts={[account]} current="a" invoke={invoke as Invoke} alibaba={alibaba as Invoke} />);
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /First fixture/ }));
  expect(alibaba).toHaveBeenCalledExactlyOnceWith({ kind: "cachedBody", accountId: "a", folder: "INBOX", uidValidity: 7, uid: 42 });
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "a" })));
  await act(async () => finish({ text: "Body for the original mailbox" }));
  expect(screen.queryByRole("article")).toBeNull();
  expect(screen.getByRole("button", { name: /First fixture/ })).toBeTruthy();
});

it("keeps unrelated results and their open body when refresh fails after one account is cleared", async () => {
  const invoke = vi.fn().mockResolvedValueOnce({ items: [firstHit, secondHit], more: false }).mockRejectedValueOnce(new Error("local read failed"));
  const gmail = vi.fn(async () => ({ plainText: "Unrelated cached body" }));
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /First fixture/ }));
  await screen.findByText("Unrelated cached body");
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-cleared", { detail: "b" })));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByText("Unrelated cached body")).toBeTruthy();
  expect(screen.getByRole("button", { name: /First fixture/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Second fixture/ })).toBeNull();
});

const firstPage = { items: Array.from({ length: 40 }, (_, index) => ({
  ...firstHit, id: `first-${index}`, subject: `First page hit ${index}`,
})), more: true };
const secondPage = { items: [secondHit], more: false };

it("refreshes the current search page and keeps its opened message", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(secondPage).mockResolvedValueOnce(secondPage);
  const gmail = vi.fn(async () => ({ plainText: "The page-two cached body" }));
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: /Second fixture/ }));
  await screen.findByText("The page-two cached body");
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "b" })));
  expect(invoke.mock.calls.map(([request]) => request.offset)).toEqual([0, 40, 40]);
  expect(screen.getByText("The page-two cached body")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
});

it("refreshes a requested page even when navigation has not finished yet", async () => {
  let finishEarlierRead!: (value: unknown) => void;
  const invoke = vi.fn().mockResolvedValueOnce(firstPage)
    .mockImplementationOnce(() => new Promise(resolve => { finishEarlierRead = resolve; }))
    .mockResolvedValueOnce(secondPage);
  beginAllAccountSearch(invoke as Invoke, vi.fn() as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "a" })));
  expect(invoke.mock.calls.map(([request]) => request.offset)).toEqual([0, 40, 40]);
  expect(await screen.findByRole("button", { name: /Second fixture/ })).toBeTruthy();
  await act(async () => finishEarlierRead({ items: [{ ...secondHit, subject: "Stale second page" }], more: false }));
  expect(screen.queryByText("Stale second page")).toBeNull();
});

it("returns to the first search page if clearing a cache removes the current page", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage)
    .mockResolvedValueOnce({ items: [], more: false }).mockResolvedValueOnce({ items: [firstHit], more: false });
  const gmail = vi.fn(async () => ({ plainText: "Offline cached message to remove" }));
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: /Second fixture/ }));
  await screen.findByText("Offline cached message to remove");
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-cleared", { detail: "b" })));
  expect(invoke.mock.calls.map(([request]) => request.offset)).toEqual([0, 40, 40, 0]);
  expect(await screen.findByRole("button", { name: /First fixture/ })).toBeTruthy();
  expect(screen.queryByText("Offline cached message to remove")).toBeNull();
  expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
});
