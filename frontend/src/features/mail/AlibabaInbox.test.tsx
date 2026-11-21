import {act,cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {Mail,type Invoke} from "./index";
import {setLocale} from "../../shared/i18n";
afterEach(()=>{cleanup();vi.restoreAllMocks()});
const summary={uid:30,subject:"Inbox fixture",sender:"from@example.test",replyTo:"reply@example.test"};
function setup(provider="alibaba",initiallyConfigured=true,backlog=0){
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
    case "cachedBody":throw Error("mail_cache_empty");
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
  expect(a.kinds()).toEqual(["credentialStatus","cachedPage","cachedFolders"]);
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
