import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { SavedOutputs } from "./SavedOutputs";
import { type SavedOutput, type SavedOutputPage, validSavedOutput } from "./saved-output-types";
const id="12345678-1234-4234-8234-123456789abc";
const item: SavedOutput={receiptVersion:"a".repeat(64),integrity:"not_checked",receipt:{schemaVersion:1,profile:"resource.save.draft1",saveId:id,workspaceId:"ws",relativePath:`.zicode/outputs/${id}/result.txt`,mimeType:"text/plain",byteLength:5,contentVersion:"0".repeat(64),preparedAt:"2026-10-10T02:00:00Z",source:{pluginId:"test.source",capabilityId:"copy",resourceId:id,packageVersion:"0.1.0"}}};
const page: SavedOutputPage={schemaVersion:1,profile:"resource.library.draft1",workspaceId:"ws",items:[item],total:1,offset:0,pageSize:40,hasMore:false,skippedEntries:0,payloadsRead:false};
const target=()=>({workspaceId:"ws",sceneId:"programming"});
function gateway(){return {list:vi.fn(async()=>page),read:vi.fn(async()=>new TextEncoder().encode("hello").buffer)};}
beforeEach(()=>{setLocale("en");vi.stubGlobal("crypto",{subtle:{digest:vi.fn(async()=>new Uint8Array(32).buffer)}});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();setLocale("zh-CN");});
describe("saved plugin output library",()=>{
  it("loads only metadata on explicit expansion and searches without payload reads",async()=>{
    const g=gateway();render(<SavedOutputs gateway={g} getTarget={target}/>);expect(g.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Saved plugin files"));await screen.findByText("test.source · copy");expect(g.read).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Search saved plugin files"),{target:{value:"copy"}});fireEvent.click(screen.getByText("Search"));
    await waitFor(()=>expect(g.list).toHaveBeenCalledTimes(2));expect(g.list.mock.calls[1]).toMatchObject(["programming","ws",{query:"copy",offset:0}]);
  });
  it("verifies on click and renders saved HTML-looking content as literal text",async()=>{
    const g=gateway();g.read.mockResolvedValue(new TextEncoder().encode("<b>x").buffer);const row={...item,receipt:{...item.receipt,byteLength:4}};g.list.mockResolvedValue({...page,items:[row]});
    render(<SavedOutputs gateway={g} getTarget={target}/>);fireEvent.click(screen.getByText("Saved plugin files"));await screen.findByText("test.source · copy");
    fireEvent.click(screen.getByText("Preview saved file"));await screen.findByDisplayValue("<b>x");expect(document.querySelector(".saved-output-preview b")).toBeNull();
    expect(g.read).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByText("Close preview"));expect(document.querySelector(".saved-output-preview")).toBeNull();
  });
  it("rejects byte mismatch, clears data, preserves a fixed error and permits refreshing",async()=>{
    const g=gateway();g.read.mockResolvedValue(new Uint8Array(1).buffer);
    render(<SavedOutputs gateway={g} getTarget={target}/>);fireEvent.click(screen.getByText("Saved plugin files"));await screen.findByText("test.source · copy");
    fireEvent.click(screen.getByText("Preview saved file"));await screen.findByText(/The saved file changed/);expect(document.querySelector(".saved-output-preview")).toBeNull();
    expect((screen.getByText("Search") as HTMLButtonElement).disabled).toBe(false);
  });
  it("drops a read completed after closing without creating a preview or download",async()=>{
    const g=gateway();let resolve!:(bytes:ArrayBuffer)=>void;g.read.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    render(<SavedOutputs gateway={g} getTarget={target}/>);fireEvent.click(screen.getByText("Saved plugin files"));await screen.findByText("test.source · copy");
    fireEvent.click(screen.getByText("Preview saved file"));fireEvent.click(screen.getByText("Saved plugin files"));resolve(new TextEncoder().encode("hello").buffer);
    await waitFor(()=>expect(document.querySelector(".saved-output-preview")).toBeNull());
  });
  it("downloads only on explicit click using a generated name and revokes the URL",async()=>{
    const g=gateway(), create=vi.fn(()=>"blob:test"),revoke=vi.fn();vi.stubGlobal("URL",Object.assign(class extends URL {},{createObjectURL:create,revokeObjectURL:revoke}));
    const click=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(()=>{});
    render(<SavedOutputs gateway={g} getTarget={target}/>);fireEvent.click(screen.getByText("Saved plugin files"));await screen.findByText("test.source · copy");expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Download saved file"));await screen.findByText("Verified original file downloaded.");expect(click).toHaveBeenCalledOnce();
    await waitFor(()=>expect(revoke).toHaveBeenCalledWith("blob:test"));
  });
  it("rejects forged destination or workspace metadata before rendering rows",async()=>{
    expect(validSavedOutput({...item,receipt:{...item.receipt,relativePath:"../private"}},"ws")).toBe(false);
    expect(validSavedOutput(item,"foreign")).toBe(false);
    const g=gateway();g.list.mockResolvedValue({...page,items:[{...item,receipt:{...item.receipt,relativePath:"../private"}}]});
    render(<SavedOutputs gateway={g} getTarget={target}/>);fireEvent.click(screen.getByText("Saved plugin files"));await screen.findByText(/Saved files could not be loaded/);expect(screen.queryByText("Preview saved file")).toBeNull();
  });
  it("recognizes bounded archive outputs with the matching saved extension",()=>{
    const receipt={...item.receipt,mimeType:"application/x-zicode-archive-targzip",
      relativePath:`.zicode/outputs/${id}/result.tar.gz`};
    expect(validSavedOutput({...item,receipt},"ws")).toBe(true);
    expect(validSavedOutput({...item,receipt:{...receipt,relativePath:`.zicode/outputs/${id}/result.bin`}},"ws")).toBe(false);
    expect(validSavedOutput({...item,receipt:{...receipt,mimeType:"text/html"}},"ws")).toBe(false);
  });
});
