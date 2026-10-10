import { act, fireEvent } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import type { ManualTool, ManualToolApi, ToolPage } from "../toolCenter/manual-tools";
import { ToolCommandPicker } from "./ToolCommandPicker";

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.useRealTimers(); });
const scope = { sceneId: "programming", workspaceId: "fixture" };
const tool = (i: number): ManualTool => ({ toolId: `tool-${i}`, accessId: `manual.tool:${i}`, pluginId: "fixture", capabilityId: `text.${i}`, title: `Text ${i}`, applicationName: "Fixture", publisher: "Studio", version: "0.1.0", enabled: true, runtime: "wasi" });
function gateway() {
  return { searchTools: vi.fn<ManualToolApi["searchTools"]>(async () => ({ items: [tool(0),tool(1)], total: 2, revision: "rev", nextOffset: null })), loadTool: vi.fn(), invoke: vi.fn() };
}
async function mount(api = gateway()) {
  setLocale("en"); vi.useFakeTimers();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root); const onOpen = vi.fn();
  await act(async () => root.render(<ToolCommandPicker api={api} scope={scope} onOpen={onOpen} />));
  return {container, onOpen, api};
}
async function settle() { await act(async () => { await vi.advanceTimersByTimeAsync(201); }); }
it("browses only metadata and opens the keyboard-selected tool without executing", async () => {
  const {container, api, onOpen} = await mount(); await settle();
  const input = container.querySelector("input") as HTMLInputElement;
  expect(api.loadTool).not.toHaveBeenCalled(); expect(api.invoke).not.toHaveBeenCalled();
  await act(async () => fireEvent.keyDown(input, {key:"ArrowDown"}));
  await act(async () => fireEvent.keyDown(input, {key:"Enter", isComposing:true}));
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => fireEvent.keyDown(input, {key:"Enter"}));
  expect(onOpen).toHaveBeenCalledWith(tool(1),"rev");
});
it("pages server results, scopes favorites and resets query to the first page", async () => {
  const api = gateway(); api.searchTools.mockResolvedValue({items:Array.from({length:40},(_,i)=>tool(i)),total:205,revision:"rev",accessRevision:8,nextOffset:40});
  const {container} = await mount(api); await settle();
  await act(async () => fireEvent.click([...container.querySelectorAll("button")].find(button=>button.textContent === "Favorite tools") as HTMLElement)); await settle();
  expect(api.searchTools).toHaveBeenLastCalledWith("programming",{query:"",offset:0,revision:null,view:"favorites",workspaceId:"fixture"});
  await act(async () => fireEvent.keyDown(container.querySelector("input") as HTMLElement,{key:"PageDown"})); await settle();
  expect(api.searchTools).toHaveBeenLastCalledWith("programming",{query:"",offset:40,revision:"rev",accessRevision:8,view:"favorites",workspaceId:"fixture"});
  await act(async () => fireEvent.change(container.querySelector("input") as HTMLElement,{target:{value:"204"}})); await settle();
  expect(api.searchTools).toHaveBeenLastCalledWith("programming",{query:"204",offset:0,revision:null,view:"favorites",workspaceId:"fixture"});
  expect(api.invoke).not.toHaveBeenCalled();
});
it("discards late responses and blocks stale selection while searching", async () => {
  let complete!: (page: ToolPage) => void;
  const api = gateway(); api.searchTools.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  const {container,onOpen} = await mount(api); await settle();
  await act(async () => fireEvent.change(container.querySelector("input") as HTMLElement,{target:{value:"new"}})); await settle();
  await act(async () => complete({items:[tool(99)],total:1,revision:"old",nextOffset:null}));
  expect(container.textContent).not.toContain("Text 99");
  await act(async () => fireEvent.change(container.querySelector("input") as HTMLElement,{target:{value:"pending"}}));
  await act(async () => fireEvent.keyDown(container.querySelector("input") as HTMLElement,{key:"Enter"}));
  expect(onOpen).not.toHaveBeenCalled();
});
it("shows catalog errors and retries from a fresh revision", async () => {
  const api = gateway(); api.searchTools.mockRejectedValueOnce({code:"catalog_changed"});
  const {container} = await mount(api); await settle();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Reload");
  await act(async () => fireEvent.click([...container.querySelectorAll("button")].find(button=>button.textContent === "Reload tools") as HTMLElement)); await settle();
  expect(container.querySelectorAll('[role="option"]')).toHaveLength(2);
});
