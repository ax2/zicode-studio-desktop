import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createResourceInputModes } from "./plugin-resource-input-modes.js";
import { webcrypto } from "node:crypto";
const controllers = [];
afterEach(() => { for (const c of controllers.splice(0)) c.destroy(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("loads a confirmed file only for the new negotiated source mode, adopts the copy unshared and sends draft semantics", async () => {
  setLocale("en");vi.stubGlobal("crypto",webcrypto);
  const container=document.createElement("main");document.body.append(container);
  const bytes=new TextEncoder().encode("\ufeff\ufeff# imported"),resource={resourceId:"confirmed",contentVersion:Buffer.from(await webcrypto.subtle.digest("SHA-256",bytes)).toString("hex")};
  const changed=vi.fn(),readInput=vi.fn(async(_resource,offset,length)=>({offset,byteLength:Math.min(length,bytes.length-offset),eof:offset+length>=bytes.length,dataBase64:Buffer.from(bytes.subarray(offset,offset+length)).toString("base64")}));
  const files=vi.fn(options=>({destroy:vi.fn(()=>options.onResource(null))}));
  const c=createResourceInputModes({container,minResources:1,maxResources:1,resourceLabels:["Markdown text"],markdownDraftMode:true,readInput,onResource:changed,
    plugin:{id:"markdown",capabilities:[{id:"render"}]},target:{instanceId:"runtime",sessionId:"session"},gateway:{},isCurrent:()=>true},files,undefined,"resource.wasi.markdown.v1");controllers.push(c);
  const button=text=>[...container.querySelectorAll("button")].find(e=>e.textContent===text);
  container.querySelector("textarea").value="previous draft";expect(c.getInputOptions()).toEqual({sourceMode:"draft"});button("Choose files").click();
  expect(c.getInputOptions()).toEqual({sourceMode:"file"});expect(button("Load as editable copy").disabled).toBe(true);
  files.mock.calls[0][0].onResource(resource);button("Load as editable copy").click();expect(readInput).not.toHaveBeenCalled();
  button("Keep current draft").click();button("Paste text").click();expect(container.querySelector("textarea").value).toBe("previous draft");
  button("Choose files").click();files.mock.calls.at(-1)[0].onResource(resource);button("Load as editable copy").click();button("Replace draft and load file").click();
  await vi.waitFor(()=>expect(container.querySelector("textarea")?.value).toBe("\ufeff# imported"));
  expect(c.getInputOptions()).toEqual({sourceMode:"draft"});expect(changed).toHaveBeenLastCalledWith(null);expect(readInput).toHaveBeenCalledTimes(2);
});
it("offers the trusted single Markdown role without inventing an input MIME declaration and retains its draft", () => {
  setLocale("en"); const container = document.createElement("main"); document.body.append(container);
  const files = vi.fn(() => ({ destroy: vi.fn() })), onResource = vi.fn();
  controllers.push(createResourceInputModes({ container, minResources: 1, maxResources: 1, resourceLabels: ["Markdown text"], onResource,
    plugin: { id: "markdown", capabilities: [{ id: "render" }] }, target: { instanceId: "runtime", sessionId: "session" }, gateway: {}, isCurrent: () => true }, files, undefined, "resource.wasi.markdown.v1"));
  expect(files).not.toHaveBeenCalled(); const input = container.querySelector("textarea"); input.value = "# Settings\n中文";
  const button = text => [...container.querySelectorAll("button")].find(item => item.textContent === text);
  button("Choose files").click(); expect(files).toHaveBeenCalledOnce(); expect(container.querySelector("textarea")).toBeNull();
  button("Paste text").click(); expect(container.querySelector("textarea").value).toBe("# Settings\n中文");
  setLocale("zh-CN"); expect(container.querySelector("textarea").value).toBe("# Settings\n中文"); expect(onResource).toHaveBeenCalled();
});
it("keeps unknown profiles, mismatched roles, and ordinary binary tools in file mode", () => {
  for (const [profile, labels, maxResources] of [["resource.wasi.markdown.v2", ["Markdown text"], 1], ["resource.wasi.markdown.v1", ["other"], 1], ["resource.wasi.markdown.v1", ["Markdown text"], 2], [undefined, ["Markdown text"], 1]]) {
    const files = vi.fn(() => ({ destroy: vi.fn() }));
    controllers.push(createResourceInputModes({ container: document.createElement("div"), minResources: 1, maxResources, resourceLabels: labels, onResource() {} }, files, undefined, profile));
    expect(files).toHaveBeenCalledOnce();
  }
});
