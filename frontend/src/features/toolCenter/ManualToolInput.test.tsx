import { act, fireEvent } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";
import { toolFields } from "./manual-tool-fields";

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async()=>{for(const root of roots.splice(0)) await act(async()=>root.unmount());document.body.replaceChildren();});
async function mount(schema:unknown) {
  setLocale("en"); const container=document.createElement("div");document.body.append(container); const root=createRoot(container);roots.push(root);
  const tool:ManualTool={toolId:"typed",accessId:"typed",pluginId:"fixture",capabilityId:"typed",title:"Typed",applicationName:"Fixture",publisher:"Studio",version:"0.1.0",runtime:"javascript",enabled:true};
  const api:ManualToolApi={searchTools:vi.fn(),loadTool:vi.fn(async()=>({pluginId:"fixture",version:"0.1.0",revision:"rev",enabled:true,capability:{id:"typed",inputSchema:schema},permissions:[]})),invoke:vi.fn(async()=>({result:{received:true}}))};
  await act(async()=>root.render(<ManualToolDetail tool={tool} revision="rev" api={api} scope={{sceneId:"programming",workspaceId:"workspace"}} />));
  const field=(key:string)=>container.querySelector(`[id$="-${key}"]`) as HTMLInputElement;
  const change=async(key:string,value:string)=>{await act(async()=>fireEvent.change(field(key),{target:{value}}));};
  const submit=async()=>{await act(async()=>fireEvent.submit(container.querySelector("form") as HTMLFormElement));};
  return{container,api,field,change,submit};
}
it("renders scalar controls and sends false, zero and selected numeric values with JSON types",async()=>{
  const {api,field,change,submit}=await mount({type:"object",required:["count","flag"],properties:{count:{type:"integer",minimum:0,maximum:10},flag:{type:"boolean"},ratio:{type:"number",enum:[0.5,1]},note:{type:"string",enum:["", "literal"]},optional:{type:"number"}}});
  expect(field("count").tagName).toBe("INPUT");expect(field("flag").tagName).toBe("SELECT");
  await change("count","0");await change("flag","1");await change("ratio","0");await change("note","0");await submit();
  expect(api.invoke).toHaveBeenCalledWith("programming","workspace","fixture","typed",{count:0,flag:false,ratio:0.5,note:""},{catalogRevision:"rev"});
});
it("does not invoke on required, range, integer or precision failures and focuses the invalid field",async()=>{
  const {api,container,field,change,submit}=await mount({type:"object",required:["count"],properties:{count:{type:"integer",minimum:0,maximum:10}}});
  await submit();expect(api.invoke).not.toHaveBeenCalled();expect(document.activeElement).toBe(field("count"));
  for(const invalid of ["11","1.5","9007199254740993"]) {await change("count",invalid);await submit();expect(api.invoke).not.toHaveBeenCalled();expect(container.querySelector('[role="alert"]')).toBeTruthy();}
  await change("count","2");await submit();expect(api.invoke).toHaveBeenCalledTimes(1);expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("keeps required empty string legal and counts Unicode code points",async()=>{
  const {api,change,submit}=await mount({type:"object",required:["text"],properties:{text:{type:"string",maxLength:1}}});
  await submit();expect(api.invoke).toHaveBeenLastCalledWith("programming","workspace","fixture","typed",{text:""},{catalogRevision:"rev"});
  await change("text","😀");await submit();expect(api.invoke).toHaveBeenLastCalledWith("programming","workspace","fixture","typed",{text:"😀"},{catalogRevision:"rev"});
});

it("keeps required fields first in provider order and renders plain accessible descriptions", async()=>{
  const schema={type:"object",required:["text","count"],properties:{
    secondary:{type:"string",title:"Supplement",description:"<img src=x onerror=alert(1)>\nCompare only if supplied"},
    text:{type:"string",description:"Source report"},count:{type:"integer",description:"Number of reports"},
    flag:{type:"boolean",description:"Include details"},
  }};
  expect(toolFields(schema)?.map(field=>field.key)).toEqual(["text","count","secondary","flag"]);
  const {container,api,field,change,submit}=await mount(schema);
  const controls=Array.from(container.querySelectorAll("form textarea, form input, form select"));
  expect(controls).toEqual([field("text"),field("count"),field("secondary"),field("flag")]);
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  for(const key of ["text","count","secondary","flag"]) {
    const hints=field(key).getAttribute("aria-describedby")?.split(" ").map(id=>document.getElementById(id)?.textContent).join(" ");
    expect(hints).toContain(key==="text"?"Source report":key==="count"?"Number of reports":key==="secondary"?"Compare only if supplied":"Include details");
    expect(hints).toContain(["text","count"].includes(key)?"Required input":"Optional input");
  }
  await change("text","source"); await change("count","0"); await submit();
  expect(api.invoke).toHaveBeenCalledWith("programming","workspace","fixture","typed",{text:"source",count:0},{catalogRevision:"rev"});
});

it("provides result navigation only after execution and never moves focus automatically",async()=>{
  const scroll=vi.fn(); const previous=HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView=scroll;
  try {
    const {container,api,field,submit}=await mount({type:"object",properties:{text:{type:"string"}}});
    const button=(text:string)=>Array.from(container.querySelectorAll("button")).find(node=>node.textContent===text);
    const click=async(text:string)=>{const target=button(text);if(!target) throw new Error(`Missing button: ${text}`);await act(async()=>fireEvent.click(target));};
    expect(button("View latest execution")).toBeUndefined();
    field("text").focus(); await submit();
    expect(document.activeElement).toBe(field("text")); expect(scroll).not.toHaveBeenCalled();
    await click("View latest execution");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Latest execution");
    expect(scroll).toHaveBeenLastCalledWith({block:"start"});
    await click("Back to inputs");
    expect(document.activeElement).toBe(container.querySelector("form"));
    expect(api.invoke).toHaveBeenCalledTimes(1);
    vi.mocked(api.invoke).mockResolvedValue({result:{contractVersion:"1.0.0-rc.1",ok:false,data:null,error:{code:"INVALID",message:"Try again"}}});
    await submit(); await click("View latest execution");
    expect(document.activeElement?.textContent).toContain("INVALID");
    expect(api.invoke).toHaveBeenCalledTimes(2);
  } finally { HTMLElement.prototype.scrollIntoView=previous; }
});
