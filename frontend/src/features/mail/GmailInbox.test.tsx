import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
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
      case "cachedPage":return null;
      case "connect":grant={connected:true,read:true,send:r.send===true};return grant;
      case "list":return r.cursor?{items:[{...entry,id:"ghi",subject:"Older fixture"}],nextCursor:null}:{items:[entry],nextCursor:"p2"};
      case "read":return {...entry,plainText:"<img src='https://invalid.test/tracker'>"};
      case "delivery":return delivery?{status:delivery}:null;
      case "send":expect(r).toEqual({kind:"send",accountId:"one",draftId:"d",revision:4,confirmed:true});delivery="unknown";return {status:delivery};
      default:throw Error("Unexpected request "+String(r.kind));
    }
  });
  const sign=await screen.findByRole("button",{name:"Sign in to read Gmail"});await waitFor(()=>expect(sign.matches(":disabled")).toBe(false));
  expect(view.calls.mock.calls.map(([r])=>r.kind)).toEqual(["status","cachedPage"]);
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
  expect(v.calls.mock.calls.every(([r])=>["cachedBody","cachedPage","status"].includes(String(r.kind)))).toBe(true);
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