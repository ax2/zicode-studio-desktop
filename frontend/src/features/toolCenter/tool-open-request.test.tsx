import { act, fireEvent } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ToolCenterApp } from "./ToolCenterApp";
import type { ManualTool, ManualToolApi } from "./manual-tools";
import { setLocale } from "../../shared/i18n";

it("opens a requested tool once and preserves drafts when requested again, with the eight-tab limit", async () => {
  setLocale("en"); vi.useFakeTimers();
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const scope = {sceneId:"programming",workspaceId:"fixture"};
  const tool = (i:number): ManualTool => ({toolId:`tool-${i}`,accessId:`manual.tool:${i}`,pluginId:"fixture",capabilityId:`text.${i}`,title:`Text ${i}`,applicationName:"Fixture",publisher:"Studio",version:"0.1.0",enabled:true,runtime:"wasi"});
  const api: ManualToolApi = {
    searchTools: vi.fn(async()=>({items:[],total:0,revision:"rev",nextOffset:null})),
    loadTool: vi.fn(async(_scene, selected)=>({pluginId:"fixture",version:"0.1.0",revision:selected.revision,enabled:true,capability:{id:selected.capabilityId,inputSchema:{type:"object",properties:{text:{type:"string"}}}},permissions:[]})),
    invoke: vi.fn(),
  };
  async function open(i:number) { await act(async()=>root.render(<ToolCenterApp entries={[]} scope={scope} toolApi={api} requestedTool={{tool:tool(i),revision:"rev"}} onOpen={vi.fn()} onManage={vi.fn()} onCommands={vi.fn()} />)); }
  try {
    await open(0);
    expect(api.loadTool).toHaveBeenCalledTimes(1); expect(api.invoke).not.toHaveBeenCalled();
    await act(async()=>fireEvent.change(container.querySelector("textarea") as HTMLElement,{target:{value:"retained draft"}}));
    await open(0);
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("retained draft");
    expect(api.loadTool).toHaveBeenCalledTimes(1);
    for(let i=1;i<8;i++) await open(i);
    await open(8);
    expect(api.loadTool).toHaveBeenCalledTimes(8); expect(api.invoke).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Close an opened tool before opening another.");
  } finally { await act(async()=>root.unmount()); container.remove(); vi.useRealTimers(); }
});
