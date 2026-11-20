import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CachedMailSearch } from "./CachedMailSearch";
import { setLocale } from "../../shared/i18n";
import type { Invoke } from "./index";

afterEach(cleanup);
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
