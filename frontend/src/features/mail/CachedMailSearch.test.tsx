import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CachedMailSearch } from "./CachedMailSearch";
import { setLocale } from "../../shared/i18n";
import type { Invoke } from "./index";

afterEach(cleanup);
it("filters the cached Gmail labels of another account without changing the active mailbox", async () => {
  setLocale("en");
  const accounts = [
    { id: "a", address: "first@example.test", provider: "alibaba" },
    { id: "b", address: "second@example.test", provider: "gmail" },
  ];
  const local = vi.fn(async (_request: Record<string, unknown>) => ({ items: [], more: false }));
  const gmail = vi.fn(async (_request: Record<string, unknown>) => [{ id: "Label_42", name: "Invoices" }]);
  render(<CachedMailSearch accounts={accounts} current="a" invoke={local as Invoke} gmail={gmail as Invoke} />);
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "invoice" } });
  fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "b" } });
  await screen.findByRole("option", { name: "Invoices" });
  expect(gmail).toHaveBeenCalledExactlyOnceWith({ kind: "cachedLabels", accountId: "b" });
  fireEvent.change(screen.getByLabelText("Search Gmail label"), { target: { value: "Label_42" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("No matching cached messages.");
  expect(local).toHaveBeenLastCalledWith({ kind: "search", account: "b", label: "Label_42", query: "invoice", offset: 0 });
  fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "" } });
  expect(screen.queryByLabelText("Search Gmail label")).toBeNull();
  expect(screen.queryByText("No matching cached messages.")).toBeNull();
  expect(screen.getByDisplayValue("invoice")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("No matching cached messages.");
  expect(local).toHaveBeenLastCalledWith({ kind: "search", account: null, query: "invoice", offset: 0 });
});

it("shows which IMAP folder each match belongs to and searches only the chosen folder", async () => {
  setLocale("en");
  const account = { id: "a", address: "first@example.test", provider: "alibaba" };
  const hit = { account: account.id, address: account.address, provider: account.provider, id: "42", epoch: 7, subject: "Invoice", sender: "Fixture" };
  const local = vi.fn(async (request: Record<string, unknown>) => ({
    items: [{ ...hit, folder: "Archive" }, { ...hit, folder: "INBOX" }].filter(item => !request.label || request.label === item.folder),
    more: false,
  }));
  const alibaba = vi.fn(async (request: Record<string, unknown>) => request.kind === "cachedFolders"
    ? [{ id: "Archive", name: "Archive" }, { id: "INBOX", name: "INBOX" }] : { text: "Archived invoice" });
  render(<CachedMailSearch accounts={[account]} current="a" invoke={local as Invoke} alibaba={alibaba as Invoke} />);
  await screen.findByRole("option", { name: "Archive" });
  expect(alibaba).toHaveBeenLastCalledWith({ kind: "cachedFolders", accountId: "a" });
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "invoice" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const archived = await screen.findByRole("button", { name: /Invoice.*Archive/ });
  expect(screen.getByRole("button", { name: /Invoice.*Inbox/ })).toBeTruthy();
  fireEvent.click(archived);
  await screen.findByText("Archived invoice");
  expect(archived.getAttribute("aria-pressed")).toBe("true");
  expect(alibaba).toHaveBeenLastCalledWith({ kind: "cachedBody", accountId: "a", folder: "Archive", uidValidity: 7, uid: 42 });
  fireEvent.change(screen.getByLabelText("Search IMAP folder"), { target: { value: "Archive" } });
  expect(screen.queryByText("Archived invoice")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByRole("button", { name: /Invoice.*Archive/ });
  expect(local).toHaveBeenLastCalledWith({ kind: "search", account: "a", label: "Archive", query: "invoice", offset: 0 });
  expect(screen.queryByRole("button", { name: /Invoice.*Inbox/ })).toBeNull();
});

it("discards stale label lists and resets a removed folder without replaying a wider search", async () => {
  setLocale("en");
  const accounts = [
    { id: "a", address: "first@example.test", provider: "gmail" },
    { id: "b", address: "second@example.test", provider: "alibaba" },
  ];
  const local = vi.fn(async (_request: Record<string, unknown>) => ({ items: [], more: false }));
  let resolveLabels!: (labels: Array<{ id: string; name: string }>) => void;
  const gmail = vi.fn(() => new Promise(resolve => { resolveLabels = resolve; }));
  const alibaba = vi.fn().mockResolvedValueOnce([{ id: "Archive", name: "Archive" }]).mockResolvedValueOnce([]);
  render(<CachedMailSearch accounts={accounts} current="a" invoke={local as Invoke} gmail={gmail as Invoke} alibaba={alibaba as Invoke} />);
  fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "b" } });
  await screen.findByRole("option", { name: "Archive" });
  await act(async () => resolveLabels([{ id: "Late_Gmail", name: "Late Gmail label" }]));
  expect(screen.queryByRole("option", { name: "Late Gmail label" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Search IMAP folder"), { target: { value: "Archive" } });
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "invoice" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("No matching cached messages.");
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-directory-updated", { detail: "b" })));
  expect((screen.getByLabelText("Search IMAP folder") as HTMLSelectElement).value).toBe("");
  expect(screen.queryByText("No matching cached messages.")).toBeNull();
  expect(screen.getByDisplayValue("invoice")).toBeTruthy();
  expect(local).toHaveBeenCalledExactlyOnceWith({ kind: "search", account: "b", label: "Archive", query: "invoice", offset: 0 });
});

const directoryFailure = "Could not read saved labels or folders.";
const directoryRetry = "Retry saved labels or folders";

it.each([
  ["gmail", "cachedLabels", "Search Gmail label"],
  ["alibaba", "cachedFolders", "Search IMAP folder"],
])("recovers a missing initial %s search directory without a server request", async (provider, kind, filter) => {
  setLocale("en");
  const account = { id: "one", address: "first@example.test", provider };
  let available = false;
  const directory = vi.fn(async () => {
    if (!available) throw Error("local directory unavailable");
    return [{ id: "Archive", name: "Recovered archive" }];
  });
  const local = vi.fn(async () => ({ items: [], more: false }));
  render(<CachedMailSearch accounts={[account]} current="one" invoke={local as Invoke}
    gmail={provider === "gmail" ? directory as Invoke : undefined} alibaba={provider === "alibaba" ? directory as Invoke : undefined} />);
  await screen.findByText(directoryFailure);
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "saved invoice" } });
  const retry = screen.getByRole("button", { name: directoryRetry });
  await act(async () => fireEvent.click(retry));
  expect(retry.matches(":disabled")).toBe(false);
  expect(screen.getByText(directoryFailure)).toBeTruthy();

  available = true;
  fireEvent.click(retry);
  await screen.findByRole("option", { name: "Recovered archive" });
  expect(screen.queryByText(directoryFailure)).toBeNull();
  expect(screen.queryByRole("button", { name: directoryRetry })).toBeNull();
  expect(screen.getByDisplayValue("saved invoice")).toBeTruthy();
  expect(directory.mock.calls).toEqual([[{ kind, accountId: "one" }], [{ kind, accountId: "one" }], [{ kind, accountId: "one" }]]);
  expect(local).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(filter), { target: { value: "Archive" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("No matching cached messages.");
  expect(local).toHaveBeenCalledExactlyOnceWith({ kind: "search", account: "one", label: "Archive", query: "saved invoice", offset: 0 });
});

it("keeps the selected search folder and open body until a successful directory read removes that folder", async () => {
  setLocale("en");
  const account = { id: "one", address: "first@example.test", provider: "gmail" };
  const archive = { id: "Archive", name: "Saved archive" };
  const hit = { account: account.id, address: account.address, provider: account.provider, id: "42",
    folder: archive.id, epoch: null, subject: "Saved search hit", sender: "Fixture" };
  let rows: typeof archive[] | null = [archive], failed = false;
  const gmail = vi.fn(async (request: Record<string, unknown>) => {
    if (request.kind === "cachedBody") return { plainText: "Still reading this body" };
    if (request.kind !== "cachedLabels" || failed) throw Error("local directory unavailable");
    return rows;
  });
  const local = vi.fn(async () => ({ items: [hit], more: false }));
  render(<CachedMailSearch accounts={[account]} current="one" invoke={local as Invoke} gmail={gmail as Invoke} />);
  await screen.findByRole("option", { name: archive.name });
  const filter = screen.getByLabelText<HTMLSelectElement>("Search Gmail label");
  fireEvent.change(filter, { target: { value: archive.id } });
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "invoice" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Saved search hit/ }));
  await screen.findByText("Still reading this body");
  const directoryChanged = () => window.dispatchEvent(new CustomEvent("studio-mail-directory-updated", { detail: account.id }));

  failed = true;
  await act(async () => directoryChanged());
  await screen.findByText(directoryFailure);
  expect(filter.value).toBe(archive.id);
  expect(screen.getByText("Still reading this body")).toBeTruthy();
  failed = false;
  rows = [archive, { id: "Receipts", name: "Recovered receipts" }];
  fireEvent.click(screen.getByRole("button", { name: directoryRetry }));
  await screen.findByRole("option", { name: "Recovered receipts" });
  expect(filter.value).toBe(archive.id);
  expect(screen.getByText("Still reading this body")).toBeTruthy();

  failed = true;
  await act(async () => directoryChanged());
  await screen.findByText(directoryFailure);
  failed = false;
  rows = null;
  await act(async () => fireEvent.click(screen.getByRole("button", { name: directoryRetry })));
  expect(filter.value).toBe("");
  expect(screen.queryByText("Still reading this body")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Saved search hit/ })).toBeNull();
  expect(screen.getByDisplayValue("invoice")).toBeTruthy();
  expect(local).toHaveBeenCalledExactlyOnceWith({ kind: "search", account: "one", label: archive.id, query: "invoice", offset: 0 });
  expect(gmail.mock.calls.filter(([request]) => request.kind !== "cachedLabels")).toEqual([[{ kind: "cachedBody", accountId: "one", id: "42" }]]);
});

it.each(["changing account", "reading a newer directory"])("ignores a late search directory retry after %s", async change => {
  setLocale("en");
  const accounts = ["one", "two"].map(id => ({ id, address: id + "@example.test", provider: "gmail" }));
  let status: "failed" | "held" | "fresh" = "failed";
  let resolveOld!: (folders: { id: string; name: string }[]) => void;
  const gmail = vi.fn(async (request: Record<string, unknown>) => {
    if (request.accountId === "two" || status === "fresh") return [{ id: "Fresh", name: "Fresh label" }];
    if (status === "held") return new Promise(resolve => { resolveOld = resolve; });
    throw Error("local directory unavailable");
  });
  render(<CachedMailSearch accounts={accounts} current="one" invoke={vi.fn() as Invoke} gmail={gmail as Invoke} />);
  const retry = await screen.findByRole("button", { name: directoryRetry });
  status = "held";
  fireEvent.click(retry);
  expect(retry.matches(":disabled")).toBe(true);
  if (change === "changing account") {
    fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "two" } });
  } else {
    status = "fresh";
    await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-directory-updated", { detail: "one" })));
  }
  await screen.findByRole("option", { name: "Fresh label" });
  await act(async () => resolveOld([{ id: "Late", name: "Late label" }]));
  expect(screen.getByRole("option", { name: "Fresh label" })).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Late label" })).toBeNull();
  expect(screen.queryByText(directoryFailure)).toBeNull();
});

function emptyDirectory(invoke: Invoke): Invoke {
  return async <T,>(request: Record<string, unknown>) => {
    if (request.kind === "cachedFolders" || request.kind === "cachedLabels") return [] as T;
    return invoke<T>(request);
  };
}

it("opens an identically numbered result through its owning account without requesting mail from a server", async () => {
  setLocale("en");
  const accounts = [
    {id:"a",address:"first@example.test",provider:"alibaba"},
    {id:"b",address:"second@example.test",provider:"gmail"},
  ];
  const local = vi.fn(async () => ({items:accounts.map(a=>({account:a.id,address:a.address,provider:a.provider,id:"42",epoch:a.id==="a"?7:null,subject:"Shared subject",sender:a.address})),more:false}));
  const gmail = vi.fn(async()=>({plainText:"Gmail offline fixture"}));
  const ali = vi.fn(async()=>({text:"Alibaba offline fixture"}));
  render(<CachedMailSearch accounts={accounts} current="a" invoke={local as Invoke} gmail={emptyDirectory(gmail as Invoke)} alibaba={emptyDirectory(ali as Invoke)}/>);
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
  render(<CachedMailSearch accounts={accounts} current="a" invoke={invoke as Invoke} gmail={emptyDirectory(gmail as Invoke)}/>);
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
  render(<CachedMailSearch accounts={accounts} current="a" invoke={invoke} gmail={emptyDirectory(gmail)} />);
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
  render(<CachedMailSearch accounts={[account]} current="a" invoke={invoke as Invoke} alibaba={emptyDirectory(alibaba as Invoke)} />);
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
  beginAllAccountSearch(invoke as Invoke, vi.fn(async () => ({ plainText: "Opened first-page body" })) as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /^First page hit 0/ }));
  await screen.findByText("Opened first-page body");
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(screen.queryByText("Opened first-page body")).toBeTruthy();
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "b" })));
  expect(invoke.mock.calls.map(([request]) => request.offset)).toEqual([0, 40, 40]);
  expect(await screen.findByRole("button", { name: /Second fixture/ })).toBeTruthy();
  expect(screen.queryByText("Opened first-page body")).toBeNull();
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

it("downloads an uncached Gmail body from the selected search hit only after explicit action", async () => {
  const local = vi.fn(async () => ({ items: [firstHit, secondHit], more: false }));
  const gmail = vi.fn(async (request: Record<string, unknown>) => request.kind === "cachedBody" ? null : {
    plainText: "Downloaded fixture", html: '<strong>Downloaded fixture</strong><img src="https://example.invalid/remote">',
    attachments: [{ id: 0, name: "fixture.pdf", size: 20 }],
  });
  beginAllAccountSearch(local as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /Second fixture/ }));
  const download = await screen.findByRole("button", { name: "Download message body" });
  expect(gmail).toHaveBeenCalledExactlyOnceWith({ kind: "cachedBody", accountId: "b", id: "42" });
  fireEvent.click(download);
  fireEvent.click(download);
  await screen.findByText("Downloaded fixture");
  expect(gmail.mock.calls.map(([request]) => request)).toEqual([
    { kind: "cachedBody", accountId: "b", id: "42" },
    { kind: "read", accountId: "b", id: "42" },
  ]);
  expect(screen.getByRole("button", { name: "Download attachment fixture.pdf" })).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByDisplayValue("fixture")).toBeTruthy();
  expect(screen.getByRole("button", { name: /First fixture/ })).toBeTruthy();
});

it("uses the Alibaba search hit's folder and UID validity and allows retry after a read error", async () => {
  setLocale("en");
  const account = { id: "a", address: "first@example.test", provider: "alibaba" };
  const hit = { ...firstHit, provider: "alibaba", folder: "Archive", epoch: 7 };
  const local = vi.fn(async () => ({ items: [hit], more: false }));
  const alibaba = vi.fn().mockRejectedValueOnce(Error("mail_cache_empty"))
    .mockRejectedValueOnce(Error("mail_connect"))
    .mockResolvedValueOnce({ text: "Downloaded from the matching IMAP folder", bodyLimited: true });
  render(<CachedMailSearch accounts={[account]} current="a" invoke={local as Invoke} alibaba={emptyDirectory(alibaba as Invoke)} />);
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /First fixture/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Download message body" }));
  await screen.findByText("Could not connect to the mail server. Your local data is unchanged.");
  fireEvent.click(screen.getByRole("button", { name: "Download message body" }));
  await screen.findByText("Downloaded from the matching IMAP folder");
  const ref = { accountId: "a", folder: "Archive", uidValidity: 7, uid: 42 };
  expect(alibaba.mock.calls.map(([request]) => request)).toEqual([
    { kind: "cachedBody", ...ref }, { kind: "read", ...ref }, { kind: "read", ...ref },
  ]);
  expect(screen.getByText("Some message text exceeds the reading limit.")).toBeTruthy();
});

it.each(["switch scope", "clear the downloaded account"])("ignores a late download if users %s", async change => {
  const local = vi.fn().mockResolvedValueOnce({ items: [firstHit, secondHit], more: false })
    .mockResolvedValue({ items: [firstHit], more: false });
  let finish!: (body: { plainText: string }) => void;
  const gmail = vi.fn(async (request: Record<string, unknown>) => request.kind === "cachedBody" ? null :
    new Promise(resolve => { finish = resolve; }));
  beginAllAccountSearch(local as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /Second fixture/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Download message body" }));
  expect(gmail).toHaveBeenLastCalledWith({ kind: "read", accountId: "b", id: "42" });
  if (change === "switch scope") {
    fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "a" } });
  } else {
    await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-cleared", { detail: "b" })));
  }
  await act(async () => finish({ plainText: "This late body must stay closed" }));
  expect(screen.queryByText("This late body must stay closed")).toBeNull();
  expect(screen.queryByRole("article")).toBeNull();
});

it.each(["gmail", "alibaba"])("retries a failed offline read through its original %s account", async provider => {
  setLocale("en");
  const isGmail = provider === "gmail";
  const hit = isGmail ? secondHit : { ...secondHit, provider, folder: "Archive", epoch: 7 };
  const local = vi.fn(async () => ({ items: [firstHit, hit], more: false }));
  const read = vi.fn().mockRejectedValueOnce(Error("mail_storage")).mockResolvedValueOnce(
    isGmail ? { plainText: "Recovered offline fixture" } : { text: "Recovered offline fixture" },
  );
  const accounts = [
    { id: "a", address: firstHit.address, provider: "gmail" },
    { id: "b", address: hit.address, provider },
  ];
  const other = vi.fn();
  render(<CachedMailSearch accounts={accounts} current="a" invoke={local as Invoke}
    gmail={emptyDirectory((isGmail ? read : other) as Invoke)}
    alibaba={emptyDirectory((isGmail ? other : read) as Invoke)} />);
  fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Search cached mail"), { target: { value: "fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /Second fixture/ }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Download message body" })).toBeNull();
  const retry = screen.getByRole("button", { name: "Try again" });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await screen.findByText("Recovered offline fixture");
  const source = isGmail ? { id: "42" } : { folder: "Archive", uidValidity: 7, uid: 42 };
  const request = { kind: "cachedBody", accountId: "b", ...source };
  expect(read.mock.calls).toEqual([[request], [request]]);
  expect(other).not.toHaveBeenCalled();
  expect(local).toHaveBeenCalledExactlyOnceWith({ kind: "search", account: null, query: "fixture", offset: 0 });
  expect(screen.getByDisplayValue("fixture")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Download message body" })).toBeNull();
});

it.each(["switch scope", "clear account cache"])("drops an offline retry that finishes after users %s", async change => {
  const local = vi.fn().mockResolvedValueOnce({ items: [firstHit, secondHit], more: false })
    .mockResolvedValue({ items: [firstHit], more: false });
  let finish!: (body: { plainText: string }) => void;
  const gmail = vi.fn().mockRejectedValueOnce(Error("mail_storage"))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  beginAllAccountSearch(local as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /Second fixture/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(gmail).toHaveBeenLastCalledWith({ kind: "cachedBody", accountId: "b", id: "42" });
  if (change === "switch scope") {
    fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "a" } });
  } else {
    await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-cleared", { detail: "b" })));
  }
  await act(async () => finish({ plainText: "Late local body" }));
  expect(screen.queryByText("Late local body")).toBeNull();
  expect(screen.queryByRole("article")).toBeNull();
  expect(gmail).toHaveBeenCalledTimes(2);
});

it("shows cached attachments without offering to download an already cached body with no text", async () => {
  const local = vi.fn(async () => ({ items: [firstHit], more: false }));
  const gmail = vi.fn(async () => ({ plainText: null, html: null, attachments: [{ id: 0, name: "data.zip", size: 18 }] }));
  beginAllAccountSearch(local as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /First fixture/ }));
  await screen.findByRole("button", { name: "Download attachment data.zip" });
  expect(screen.queryByText("This message is not available offline. Download it explicitly to read it.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Download message body" })).toBeNull();
  expect(gmail).toHaveBeenCalledExactlyOnceWith({ kind: "cachedBody", accountId: "a", id: "42" });
});

it("keeps the last valid search page and its opened mail when navigation fails", async () => {
  let rejectNext!: (error: Error) => void;
  const nextPage = new Promise<never>((_resolve, reject) => { rejectNext = reject; });
  const invoke = vi.fn().mockResolvedValueOnce(firstPage).mockReturnValueOnce(nextPage)
    .mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);
  const gmail = vi.fn(async () => ({ plainText: "Current page remains readable" }));
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: /^First page hit 0/ }));
  await screen.findByText("Current page remains readable");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByText("Current page remains readable")).toBeTruthy();
  await act(async () => rejectNext(Error("mail_storage")));
  await screen.findByRole("alert");
  expect(screen.queryByText("Current page remains readable")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Next" }).matches(":disabled")).toBe(false);
  expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  expect(screen.getByLabelText<HTMLInputElement>("Search cached mail").value).toBe("fixture");

  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "b" })));
  expect(screen.queryByText("Current page remains readable")).toBeTruthy();
  expect(invoke.mock.calls.map(([r]) => r.offset)).toEqual([0, 40, 0]);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("button", { name: /Second fixture/ });
  expect(screen.queryByText("Current page remains readable")).toBeNull();
  expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
  expect(invoke.mock.calls.map(([r]) => r.offset)).toEqual([0, 40, 0, 40]);
  expect(gmail.mock.calls).toEqual([[{ kind: "cachedBody", accountId: "a", id: "first-0" }]]);
});

it("focuses the opened reader and returns to the exact account result while its offline body is pending", async () => {
  let finish!: (body: { plainText: string }) => void;
  const pending = new Promise<{ plainText: string }>(resolve => { finish = resolve; });
  const invoke = vi.fn().mockResolvedValue({ items: [firstHit, secondHit], more: false });
  const gmail = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ plainText: "First account body" });
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  const second = await screen.findByRole("button", { name: /^Second fixture/ });
  second.focus();
  fireEvent.click(second);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Second fixture" }));
  expect(gmail).toHaveBeenCalledWith({ kind: "cachedBody", accountId: "b", id: "42" });

  const back = screen.getByRole("button", { name: "Back to search results" });
  back.focus();
  fireEvent.click(back);
  expect(document.activeElement).toBe(second);
  expect(screen.queryByRole("article")).toBeNull();
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("fixture");
  expect(invoke).toHaveBeenCalledTimes(1);

  const first = screen.getByRole("button", { name: /^First fixture/ });
  first.focus();
  fireEvent.click(first);
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "First fixture" }));
  await screen.findByText("First account body");
  const query = screen.getByRole("searchbox");
  query.focus();
  await act(async () => finish({ plainText: "Late second account body" }));
  expect(document.activeElement).toBe(query);
  expect(screen.queryByText("Late second account body")).toBeNull();
  expect(screen.getByText("First account body")).toBeTruthy();
});

it.each(["Next", "Previous"] as const)("keeps the %s pagination control focused through a failed read", async control => {
  let fail!: (reason: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { fail = reject; });
  const invoke = vi.fn().mockResolvedValueOnce(firstPage);
  const forward = control === "Next";
  if (!forward) invoke.mockResolvedValueOnce(secondPage);
  invoke.mockReturnValueOnce(pending).mockResolvedValueOnce(forward ? secondPage : firstPage);
  const gmail = vi.fn(async () => ({ plainText: "Current search mail remains open" }));
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  if (!forward) fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: forward ? /^First page hit 0/ : /^Second fixture/ }));
  await screen.findByText("Current search mail remains open");
  const button = screen.getByRole("button", { name: control });
  button.focus();
  fireEvent.click(button);
  await screen.findByText("Searching messages…");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(button.matches(":disabled")).toBe(false);
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(invoke.mock.calls.map(([request]) => request.offset)).toEqual(forward ? [0, 40] : [0, 40, 0]);
  await act(async () => fail(Error("mail_storage")));
  await screen.findByRole("alert");
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  expect(document.activeElement).toBe(button);
  expect(screen.getByText("Current search mail remains open")).toBeTruthy();
  fireEvent.click(button);
  await screen.findByRole("button", { name: forward ? /^Second fixture/ : /^First page hit 0/ });
  expect(screen.queryByText("Current search mail remains open")).toBeNull();
  expect(invoke.mock.calls.map(([request]) => request.offset)).toEqual(forward ? [0, 40, 40] : [0, 40, 0, 0]);
});

it.each([
  { title: "reaches the last page", control: "Next", page: secondPage, result: /^Second fixture/ },
  { title: "returns to the first page", control: "Previous", page: firstPage, result: /^First page hit 0/ },
  { title: "leaves focus where the user moved it", control: "Next", page: secondPage, moveFocus: true },
  { title: "keeps the current button when paging is still available", control: "Next", page: { ...secondPage, more: true } },
  { title: "returns to the query when the cache has no results", control: "Next", page: { items: [], more: false }, empty: true },
])("$title", async ({ control, page, result, moveFocus, empty }) => {
  let finish!: (value: typeof page) => void;
  const pending = new Promise<typeof page>(resolve => { finish = resolve; });
  const invoke = vi.fn().mockResolvedValueOnce(firstPage);
  if (control === "Previous") invoke.mockResolvedValueOnce(secondPage);
  invoke.mockReturnValueOnce(pending);
  if (empty) invoke.mockResolvedValueOnce(page);
  beginAllAccountSearch(invoke as Invoke, vi.fn() as Invoke);
  if (control === "Previous") fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  const button = await screen.findByRole("button", { name: control });
  const input = screen.getByRole("searchbox");
  button.focus();
  fireEvent.click(button);
  if (moveFocus) input.focus();

  await act(async () => finish(page));
  if (empty) await screen.findByText("No matching cached messages.");
  const expected = result ? screen.getByRole("button", { name: result }) : button;
  expect(document.activeElement).toBe(moveFocus || empty ? input : expected);
});

it.each(["query", "account", "label"])("ignores a pending search page after changing the %s", async change => {
  setLocale("en");
  const accounts = [
    { id: "a", address: "first@example.test", provider: "gmail" },
    { id: "b", address: "second@example.test", provider: "gmail" },
  ];
  let finish!: (value: unknown) => void;
  const oldPage = new Promise(resolve => { finish = resolve; });
  const invoke = vi.fn().mockResolvedValueOnce(firstPage).mockReturnValueOnce(oldPage);
  const gmail = vi.fn(async () => [{ id: "Archive", name: "Archive" }]);
  render(<CachedMailSearch accounts={accounts} current="a" invoke={invoke as Invoke} gmail={gmail as Invoke}/>);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "fixture" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const next = await screen.findByRole("button", { name: "Next" });
  next.focus();
  fireEvent.click(next);
  if (change === "query") fireEvent.change(screen.getByRole("searchbox"), { target: { value: "other" } });
  else if (change === "account") fireEvent.change(screen.getByLabelText("Search scope"), { target: { value: "b" } });
  else {
    await screen.findByRole("option", { name: "Archive" });
    fireEvent.change(screen.getByLabelText("Search Gmail label"), { target: { value: "Archive" } });
  }
  const input = screen.getByRole("searchbox");
  input.focus();
  await act(async () => finish(secondPage));
  expect(document.activeElement).toBe(input);
  expect(screen.queryByRole("button", { name: /Second fixture/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "a" })));
  expect(invoke.mock.calls.map(([r]) => r.offset)).toEqual([0, 40]);
});


it("closes the previous reading when a cache refresh falls back to a different page", async () => {
  const invoke = vi.fn().mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage)
    .mockResolvedValueOnce({ items: [], more: false }).mockResolvedValueOnce(firstPage);
  const gmail = vi.fn(async () => ({ plainText: "Opened before automatic page fallback" }));
  beginAllAccountSearch(invoke as Invoke, gmail as Invoke);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: /Second fixture/ }));
  await screen.findByText("Opened before automatic page fallback");
  await act(async () => window.dispatchEvent(new CustomEvent("studio-mail-cache-updated", { detail: "a" })));
  await screen.findByRole("button", { name: /First page hit 0/ });
  expect(invoke.mock.calls.map(([request]) => request.offset)).toEqual([0, 40, 40, 0]);
  expect(screen.queryByText("Opened before automatic page fallback")).toBeNull();
  expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
});
