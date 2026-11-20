import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createMarkdownFileDraft } from "./markdown-file-draft.js";
const views = [];
async function fixture(draft = "old draft", overrides = {}) {
  vi.stubGlobal("crypto", webcrypto); setLocale("en");
  const bytes = new TextEncoder().encode("\ufeff# imported🙂"), container = document.createElement("main"); document.body.append(container);
  const resource = { resourceId: "source", contentVersion: Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex") };
  const readInput = vi.fn(async (_resource, offset, length) => ({ offset, byteLength: Math.min(length, bytes.length - offset), eof: offset + length >= bytes.length, dataBase64: Buffer.from(bytes.subarray(offset, offset + length)).toString("base64") }));
  const loaded = vi.fn(), view = createMarkdownFileDraft({ container, readInput, getDraft: () => draft, onLoaded: loaded, isCurrent: () => true, ...overrides }); views.push(view);
  view.setVisible(true);
  const button = name => [...container.querySelectorAll("button")].find(e => e.textContent === name);
  return { resource, readInput, loaded, view, container, button };
}
afterEach(() => { for (const v of views.splice(0)) v.destroy(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it("never reads before sharing and an explicit load, then protects a nonempty draft with a separate choice", async () => {
  const f = await fixture(); expect(f.button("Load as editable copy").disabled).toBe(true); f.view.setResource(f.resource);
  expect(f.readInput).not.toHaveBeenCalled(); f.button("Load as editable copy").click(); expect(f.readInput).not.toHaveBeenCalled();
  f.button("Keep current draft").click(); expect(f.loaded).not.toHaveBeenCalled(); expect(f.readInput).not.toHaveBeenCalled();
  f.button("Load as editable copy").click(); setLocale("zh-CN"); expect(f.container.textContent).toContain("替换草稿并载入文件");
  f.button("替换草稿并载入文件").click(); await vi.waitFor(() => expect(f.loaded).toHaveBeenCalledWith("# imported🙂"));
});
it("can copy into an empty draft without a discard prompt and never executes or shares the new copy", async () => {
  const f = await fixture(""); f.view.setResource(f.resource); f.button("Load as editable copy").click();
  await vi.waitFor(() => expect(f.loaded).toHaveBeenCalledWith("# imported🙂"));
  expect(f.readInput).toHaveBeenCalledTimes(2);
});
it("clears the loading message when another operation invalidates the read without changing selection", async () => {
  let current=true;const f=await fixture("",{isCurrent:()=>current});f.view.setResource(f.resource);
  const read=f.readInput.getMockImplementation();let finish;
  f.readInput.mockImplementationOnce((...args)=>new Promise(resolve=>{finish=async()=>resolve(await read(...args));}));
  f.button("Load as editable copy").click();current=false;await finish();
  await vi.waitFor(()=>expect(f.container.textContent).toContain("Loading canceled"));expect(f.loaded).not.toHaveBeenCalled();
});
it("preserves the old draft on error and ignores a late read after cancel, reselection or disposal", async () => {
  const failed = await fixture(); failed.view.setResource(failed.resource); failed.readInput.mockRejectedValue(new Error("permission_denied"));
  failed.button("Load as editable copy").click(); failed.button("Replace draft and load file").click();
  await vi.waitFor(() => expect(failed.container.textContent).toContain("previous draft is kept")); expect(failed.loaded).not.toHaveBeenCalled();
  for (const action of ["cancel", "reselect", "dispose"]) {
    const f = await fixture(""); f.view.setResource(f.resource); let resolve; const read = f.readInput.getMockImplementation();
    f.readInput.mockImplementationOnce((...args) => new Promise(r => { resolve = async () => r(await read(...args)); }));
    f.button("Load as editable copy").click();
    if (action === "cancel") f.button("Cancel loading copy").click();
    else if (action === "reselect") f.view.setResource({ ...f.resource, resourceId: "changed" });
    else f.view.destroy();
    await resolve(); await new Promise(r => setTimeout(r, 0)); expect(f.loaded).not.toHaveBeenCalled();
  }
});
