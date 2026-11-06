import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createResourcePreview } from "./plugin-resource-preview.js";
import { loadResourcePreview } from "./plugin-resource-preview-load.js";
vi.mock("./plugin-resource-preview-load.js", () => ({ loadResourcePreview: vi.fn() }));
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(options = {}) {
  setLocale("en");document.body.innerHTML="<main></main>";
  const read=vi.fn(async()=>({})),valid={current:true};
  const controller=createResourcePreview({container:document.querySelector("main"),read,isCurrent:()=>valid.current,plugin:{capabilities:[{id:"c",title:"Copy image"}]}, ...options});
  const resource={index:0,mimeType:"image/png",byteLength:10,resourceId:"id",contentVersion:"hash"};
  return {controller,read,valid,resource,show:()=>controller.show([resource],{capabilityId:"c"})};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();loadResourcePreview.mockReset();});
describe("trusted parent output preview",()=>{
  it("renders only negotiated Markdown HTML as a document and clears both document and complete HTML on close",async()=>{
    const c=fixture({executionProfile:"resource.wasi.markdown.v1"});
    c.resource.mimeType="text/html";c.resource.byteLength=10486640;
    const html='<!doctype html><h1>Settings</h1><pre><code>&lt;script&gt;x&lt;/script&gt;</code></pre>';
    loadResourcePreview.mockResolvedValue({kind:"text",text:html});
    c.show();expect(document.querySelector("button").disabled).toBe(false);document.querySelector("button").click();await flush();
    expect(document.querySelector("article h1").textContent).toBe("Settings");expect(document.querySelector("script")).toBeNull();
    document.querySelector(".markdown-output-preview button").click();expect(document.querySelector("textarea").value).toBe(html);
    [...document.querySelectorAll("button")].find(b=>b.textContent==="Close preview").click();
    expect(document.querySelector("article,textarea")).toBeNull();setLocale("zh-CN");expect(document.querySelector("article")).toBeNull();c.controller.destroy();
  });
  it("keeps the complete metadata copy separate from the thumbnail during language changes",async()=>{
    vi.stubGlobal("URL",class extends URL { static createObjectURL=()=>"blob:metadata"; static revokeObjectURL=vi.fn(); });
    const save=vi.fn(),c=fixture({executionProfile:"resource.wasi.image.metadata.v1",onSave:save});
    const full={...c.resource,byteLength:48007728},thumb={...c.resource,index:1,resourceId:"thumbnail",byteLength:1103623};
    c.controller.show([full,thumb],{capabilityId:"c"},["Cleaned image copy","Orientation preview thumbnail"]);
    const buttons=[...document.querySelectorAll("button")];
    expect(buttons[0].disabled).toBe(true);
    expect(loadResourcePreview).not.toHaveBeenCalled();
    buttons.find(button=>button.textContent==="Preview save").click();
    expect(save.mock.calls[0][0]).toEqual(full);
    loadResourcePreview.mockResolvedValue({kind:"image",blob:new Blob(),width:640,height:640});
    const preview=buttons.find(button=>button.textContent==="Preview Orientation preview thumbnail");
    preview.click();await flush();const image=document.querySelector("img");
    expect(image.src).toBe("blob:metadata");
    setLocale("zh-CN");
    expect(preview.textContent).toBe("预览方向预览缩略图");
    expect(document.body.textContent).toContain("清理后的图片副本");
    expect(document.querySelector("img")).toBe(image);
    setLocale("en");expect(preview.textContent).toBe("Preview Orientation preview thumbnail");
    expect(save).toHaveBeenCalledTimes(1);c.controller.destroy();
  });
  it("labels negotiated review resources safely and switches language without losing an open value",async()=>{
    const c=fixture({executionProfile:"resource.wasi.regex.review.v1"});
    c.resource.mimeType="text/plain";c.resource.byteLength=2097152;
    loadResourcePreview.mockResolvedValue({kind:"text",text:"<img>完整匹配"});
    c.controller.show([c.resource],{capabilityId:"c"},["Matched text"]);
    expect(document.querySelector("button").textContent).toBe("Preview Matched text");
    document.querySelector("button").click();await flush();
    const editor=document.querySelector("textarea");editor.select();
    setLocale("zh-CN");expect(document.querySelector("button").textContent).toBe("预览匹配原文");
    expect(document.querySelector("textarea")).toBe(editor);expect(editor.value).toBe("<img>完整匹配");
    expect(editor.selectionEnd).toBe(editor.value.length);expect(document.querySelector("img")).toBeNull();
    setLocale("en");expect(document.querySelector("button").textContent).toBe("Preview Matched text");
    c.controller.show([c.resource],{capabilityId:"c"},["<img src=untrusted>"]);
    expect(document.querySelector("img")).toBeNull();expect(document.body.textContent).toContain("<img src=untrusted>");
    for(const labels of [["bad\nlabel"],["x".repeat(129)],["Matched text","Captured text"],[12]]){
      c.controller.show([c.resource],{capabilityId:"c"},labels);
      expect(document.querySelector("button").textContent).toBe("Preview Output 1");
    }
    c.controller.destroy();
  });
  it("offers the complete negotiated large result in a bounded readonly editor with full selection",async()=>{
    const c=fixture({executionProfile:"resource.wasi.regex.replace.v1"});
    c.resource.mimeType="text/plain";c.resource.byteLength=2097152;
    const text="x".repeat(2097152);loadResourcePreview.mockResolvedValue({kind:"text",text});c.show();
    expect(document.querySelector("button").disabled).toBe(false);
    document.querySelector("button").click();await flush();
    const editor=document.querySelector("textarea");expect(editor.readOnly).toBe(true);expect(editor.value).toBe(text);
    [...document.querySelectorAll("button")].find(button=>button.textContent==="Select all").click();
    expect(editor.selectionEnd-editor.selectionStart).toBe(text.length);
    expect(document.querySelector("pre")).toBeNull();c.controller.clear();expect(document.querySelector("textarea")).toBeNull();c.controller.destroy();
  });
  it("does not read before a click and renders text using textContent",async()=>{
    const c=fixture();c.resource.mimeType="text/html";loadResourcePreview.mockResolvedValue({kind:"text",text:"<img src=private>"});c.show();
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
