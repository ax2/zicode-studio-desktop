import { describe, expect, it, vi } from "vitest";
import { createSavedOutputGateway } from "./saved-output-gateway.js";
function stream(values) { const read=vi.fn(); for(const value of values) read.mockResolvedValueOnce({done:false,value}); read.mockResolvedValue({done:true});return {read,cancel:vi.fn(async()=>{}),releaseLock:vi.fn()}; }
const item={receipt:{saveId:"id",byteLength:3},receiptVersion:"version"};
describe("saved output gateway",()=>{
  it("reads durable save records using the same scoped, abortable metadata transport",async()=>{
    const fetchImpl=vi.fn(async()=>({ok:true,json:async()=>({profile:"resource.save.recovery.draft1"})}));
    const g=createSavedOutputGateway({fetchImpl,location:{origin:"http://127.0.0.1:1234"}}),controller=new AbortController();
    await g.attempts("programming","ws",{query:"save-id",offset:40,signal:controller.signal});
    const [url,options]=fetchImpl.mock.calls[0];expect(url.pathname).toBe("/v2/plugin-resources/save-attempts");
    expect(url.searchParams.get("workspaceId")).toBe("ws");expect(url.searchParams.get("query")).toBe("save-id");
    expect(url.searchParams.get("offset")).toBe("40");expect(options.body).toBeUndefined();expect(options.method).toBeUndefined();
  });
  it("uses only registered workspace/id/receipt version parameters and metadata list",async()=>{
    const reader=stream([new Uint8Array([1]),new Uint8Array([2,3])]);
    const fetchImpl=vi.fn(async url=>url.pathname.endsWith('saved-outputs')?{ok:true,json:async()=>({items:[]})}:{ok:true,headers:{get:()=>"application/octet-stream"},body:{getReader:()=>reader}});
    const g=createSavedOutputGateway({fetchImpl,location:{origin:"http://127.0.0.1:1234"}});
    await g.list("programming","ws",{query:"copy",offset:40});expect(fetchImpl.mock.calls[0][0].searchParams.get("offset")).toBe("40");
    expect([...new Uint8Array(await g.read("programming","ws",item))]).toEqual([1,2,3]);
    expect(fetchImpl.mock.calls[1][0].searchParams.get("receiptVersion")).toBe("version");expect(fetchImpl.mock.calls[1][0].searchParams.has("path")).toBe(false);expect(reader.cancel).toHaveBeenCalled();
  });
  it("cancels an overlong stream and rejects short bodies and active content types",async()=>{
    for(const values of [[new Uint8Array(4)],[new Uint8Array(2)]]){
      const reader=stream(values),fetchImpl=vi.fn(async()=>({ok:true,headers:{get:()=>"application/octet-stream"},body:{getReader:()=>reader}}));
      const g=createSavedOutputGateway({fetchImpl,location:{origin:"http://127.0.0.1"}});await expect(g.read("s","w",item)).rejects.toThrow();expect(reader.cancel).toHaveBeenCalled();
    }
    const g=createSavedOutputGateway({fetchImpl:async()=>({ok:true,headers:{get:()=>"text/html"}}),location:{origin:"http://127.0.0.1"}});
    await expect(g.read("s","w",item)).rejects.toThrow();
  });
  it("does not expose raw Host error messages",async()=>{
    const g=createSavedOutputGateway({fetchImpl:async()=>({ok:false,json:async()=>({error:{code:"permission_denied",message:"private host detail"}})}),location:{origin:"http://127.0.0.1"}});
    await expect(g.list("s","w")).rejects.toMatchObject({message:"Saved output unavailable",code:"permission_denied"});
  });
});
