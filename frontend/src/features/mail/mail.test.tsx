// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {Mail,setupMailApp} from "./index";
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
  fireEvent.click(await screen.findByRole("button",{name:"New idea"}));
  expect((screen.getByLabelText("Message body") as HTMLTextAreaElement).value).toBe("正文");
  vi.spyOn(window,"confirm").mockReturnValue(true);fireEvent.click(screen.getByRole("button",{name:"Delete draft"}));
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
