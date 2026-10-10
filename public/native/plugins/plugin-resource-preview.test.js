import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createResourcePreview } from "./plugin-resource-preview.js";
import { loadResourcePreview } from "./plugin-resource-preview-load.js";
vi.mock("./plugin-resource-preview-load.js", () => ({ loadResourcePreview: vi.fn() }));
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture() {
  setLocale("en");document.body.innerHTML="<main></main>";
  const read=vi.fn(async()=>({})),valid={current:true};
  const controller=createResourcePreview({container:document.querySelector("main"),read,isCurrent:()=>valid.current,plugin:{capabilities:[{id:"c",title:"Copy image"}]}});
  const resource={index:0,mimeType:"image/png",byteLength:10,resourceId:"id",contentVersion:"hash"};
  return {controller,read,valid,resource,show:()=>controller.show([resource],{capabilityId:"c"})};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();loadResourcePreview.mockReset();});
describe("trusted parent output preview",()=>{
  it("does not read before a click and renders text using textContent",async()=>{
    const c=fixture();loadResourcePreview.mockResolvedValue({kind:"text",text:"<img src=private>"});c.show();
    expect(loadResourcePreview).not.toHaveBeenCalled();document.querySelector("button").click();await flush();
    expect(document.querySelector("pre").textContent).toBe("<img src=private>");expect(document.querySelector("img")).toBeNull();
    c.controller.destroy();expect(document.querySelector("section")).toBeNull();
  });
  it("revokes temporary image URLs on close and discards late results after destroy",async()=>{
    const create=vi.fn(()=>"blob:owned"),revoke=vi.fn();vi.stubGlobal("URL",class extends URL { static createObjectURL=create; static revokeObjectURL=revoke; });
    const c=fixture();loadResourcePreview.mockResolvedValue({kind:"image",blob:new Blob(),width:10,height:20});c.show();document.querySelector("button").click();await flush();
    expect(document.querySelector("img").src).toBe("blob:owned");document.querySelectorAll("button")[1].click();expect(revoke).toHaveBeenCalledWith("blob:owned");
    let finish;loadResourcePreview.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));document.querySelector("button").click();c.controller.destroy();finish({kind:"image",blob:new Blob(),width:1,height:1});await flush();expect(create).toHaveBeenCalledTimes(1);
  });
  it("clears copied pixels on authorization failure and stops further checks",async()=>{
    vi.useFakeTimers();const revoke=vi.fn();vi.stubGlobal("URL",class extends URL { static createObjectURL=()=>"blob:owned"; static revokeObjectURL=revoke; });
    const c=fixture();loadResourcePreview.mockResolvedValue({kind:"image",blob:new Blob(),width:1,height:1});c.show();document.querySelector("button").click();await flush();
    c.read.mockRejectedValue(new Error("private path credential"));await vi.advanceTimersByTimeAsync(5000);
    expect(document.querySelector("img")).toBeNull();expect(document.body.textContent).toContain("Preview expired or access was revoked.");expect(document.body.textContent).not.toContain("private");
    await vi.advanceTimersByTimeAsync(10000);expect(c.read).toHaveBeenCalledTimes(1);expect(revoke).toHaveBeenCalledTimes(1);c.controller.destroy();
  });
  it("keeps oversize results as metadata and prevents stale controls from clearing a new preview",async()=>{
    const c=fixture();c.resource.byteLength=9*1024*1024;c.show();expect(document.querySelector("button").disabled).toBe(true);
    const stale=document.querySelector("button");c.resource.byteLength=1;c.show();loadResourcePreview.mockResolvedValue({kind:"text",text:"current"});document.querySelector("button").click();await flush();stale.disabled=false;stale.click();await flush();expect(document.querySelector("pre").textContent).toBe("current");c.controller.destroy();
  });
});
