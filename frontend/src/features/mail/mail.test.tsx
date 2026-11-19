// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {Mail} from "./index";
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
