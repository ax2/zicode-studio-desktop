import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createFileDigestManifestGenerate } from "./file-digest-manifest-generate.js";
const hash = "a".repeat(64), text = `${hash}  a.txt\n`, capabilityId = "devtools.checksum-manifest.generate", pluginId = "com.zicode.devtools.checksum-manifest", revision = "b".repeat(64), id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roots = [];
function fixture() {
  setLocale("en"); vi.stubGlobal("crypto", webcrypto); document.body.innerHTML = "<main></main>";
  const gateway = { callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", prepareRequired: true })), searchTools: vi.fn(async () => ({ schemaVersion: 1, revision, items: [{ pluginId, capabilityId, version: "0.2.0", enabled: true, runtime: "wasi" }] })), loadTool: vi.fn(async () => ({ pluginId, capability: { id: capabilityId }, version: "0.2.0", revision })), prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId: id })), cancelCall: vi.fn(async () => ({})),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text } }, resultRef: { schemaVersion: 1, resultId: id, mimeType: "text/plain", byteLength: text.length, contentVersion: createHash("sha256").update(text).digest("hex"), packageVersion: "0.2.0" } })), textExports: { choose: vi.fn(async () => null), commit: vi.fn(), cancel: vi.fn() } };
  const onManifest = vi.fn(), onBusy = vi.fn(), verifySources = vi.fn(async () => {});
  const c = createFileDigestManifestGenerate({ container: document.querySelector("main"), gateway, getTarget: () => ({ workspaceId: "w", sceneId: "programming" }), isCurrent: () => true, verifySources, onManifest, onBusy, isBlocked: () => false }); roots.push(c); c.show([{ name: "a.txt", sha256: hash }]);
  const button = document.querySelector("button"), save = [...document.querySelectorAll("button")].find(b => b.textContent === "Save generated manifest as…");
  return { c, gateway, onManifest, onBusy, verifySources, button, save };
}
afterEach(() => { for (const c of roots.splice(0)) c.destroy(); document.body.replaceChildren(); vi.unstubAllGlobals(); setLocale("zh-CN"); });
it("generates only on explicit action, captures the Host result, and never auto saves", async () => {
  const f = fixture(); expect(f.gateway.invoke).not.toHaveBeenCalled(); f.button.click(); await vi.waitFor(() => expect(f.onManifest).toHaveBeenCalledExactlyOnceWith(text));
  expect(f.gateway.invoke.mock.calls[0][4]).toEqual({ files: [{ name: "a.txt", sha256: hash }] }); expect(f.gateway.invoke.mock.calls[0][5].captureResult).toBe(true); expect(f.verifySources).toHaveBeenCalledTimes(2); expect(f.gateway.textExports.choose).not.toHaveBeenCalled(); expect(f.save.disabled).toBe(false);
  setLocale("zh-CN"); expect(document.body.textContent).toContain("清单已生成");
});
it("checks current source access again before native destination selection", async () => {
  const f = fixture(); f.button.click(); await vi.waitFor(() => expect(f.onManifest).toHaveBeenCalledOnce()); f.verifySources.mockRejectedValueOnce(Error("revoked")); f.save.click();
  await vi.waitFor(() => expect(f.verifySources).toHaveBeenCalledTimes(3)); expect(f.gateway.textExports.choose).not.toHaveBeenCalled();
});
it("discards late output after source change and prevents a stale save", async () => {
  const f = fixture(); let finish; f.gateway.invoke.mockImplementationOnce(() => new Promise(r => { finish = r; })); f.button.click(); await vi.waitFor(() => expect(f.gateway.invoke).toHaveBeenCalledOnce()); f.c.clear(); finish({ result: { ok: false } });
  await vi.waitFor(() => expect(f.onBusy).toHaveBeenLastCalledWith(false)); expect(f.onManifest).not.toHaveBeenCalled(); expect(f.save.disabled).toBe(true);
});
it("unknown execution remains locked and offers existing recovery rather than a retry", async () => {
  const f = fixture(); f.gateway.invoke.mockRejectedValueOnce(Object.assign(Error("timeout"), { code: "plugin_capability_timeout" })); f.button.click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Tool result is unknown")); expect(f.button.disabled).toBe(true); expect(f.onManifest).not.toHaveBeenCalled();
});
