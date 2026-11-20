import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createResourcePreview } from "./plugin-resource-preview.js";
import { createResourceSave } from "./plugin-resource-save.js";

const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
const resources = [0, 1].map(index => ({ index, resourceId: `${index + 1}1111111-1111-4111-8111-111111111111`, contentVersion: "a".repeat(64), mimeType: "text/plain", byteLength: 5 }));
const roots = [];
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function fixture() {
  setLocale("en"); document.body.innerHTML = "<main></main>";
  let sequence = 0;
  const receipts = new Map();
  const gateway = {
    prepareResourceSave: vi.fn(async access => {
      const id = `${++sequence}aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      const receipt = { schemaVersion: 1, profile: "resource.save.draft1", saveId: id, workspaceId: "w", relativePath: `.zicode/outputs/${id}/result.txt`, contentVersion: access.contentVersion, mimeType: "text/plain", byteLength: 5, source: { pluginId: "p", capabilityId: "c", resourceId: access.resourceId } };
      receipts.set(id, receipt);
      return { schemaVersion: 1, profile: "resource.save.draft1", grantId: id, requiresConfirmation: true, saved: false, operation: "create_new_file", expiresInSeconds: 60, preview: receipt };
    }),
    commitResourceSave: vi.fn(async (_access, id) => ({ schemaVersion: 1, profile: "resource.save.draft1", status: "saved", saved: true, replayed: false, receipt: receipts.get(id) })),
  };
  const save = createResourceSave({ gateway, getTarget: () => ({ instanceId: "r", sessionId: "s", workspaceId: "w" }), isCurrent: () => true });
  const preview = createResourcePreview({ container: document.querySelector("main"), plugin: {}, read: vi.fn(), isCurrent: () => true, onSave: (...args) => save.open(...args) });
  preview.show(resources, owner); roots.push({ destroy() { preview.destroy(); save.destroy(); } });
  const click = async text => { const el = [...document.querySelectorAll("button")].find(e => e.textContent === text); expect(el).toBeTruthy(); el.click(); await flush(); };
  const open = async index => { document.querySelectorAll(".plugin-resource-preview-row")[index].querySelectorAll("button")[1].click(); await flush(); };
  return { gateway, preview, open, click, receipts };
}
afterEach(() => { roots.splice(0).forEach(c => { c.destroy(); }); vi.restoreAllMocks(); setLocale("zh-CN"); });
it("updates only the confirmed output and counts partial saves after the dialog closes", async () => {
  const f = fixture(); await f.open(0); expect(f.gateway.commitResourceSave).not.toHaveBeenCalled();
  await f.click("Confirm save file"); await f.click("Close");
  const rows = document.querySelectorAll(".plugin-resource-preview-row");
  expect(rows[0].textContent).toContain("Saved copy: .zicode/outputs/");
  expect(rows[1].textContent).toContain("Not saved");
  expect(document.body.textContent).toContain("Saved 1 of 2 output files. Other results remain temporary.");
  await f.open(1); await f.click("Confirm save file"); await f.click("Close");
  expect(document.body.textContent).toContain("All output files have confirmed saved copies.");
  expect(resources.every(r => r.saved === undefined)).toBe(true);
});
it("does not mark cancellation or an ambiguous write as saved", async () => {
  const f = fixture(); await f.open(0); await f.click("Cancel save");
  expect(f.gateway.commitResourceSave).not.toHaveBeenCalled();
  await f.open(0); f.gateway.commitResourceSave.mockRejectedValue(new Error("lost response"));
  await f.click("Confirm save file"); await f.click("Close");
  expect(document.body.textContent).not.toContain("Saved copy:");
  expect(document.body.textContent).toContain("These results have not been saved.");
});
it("does not apply a late confirmed save to replacement results", async () => {
  const f = fixture(); await f.open(0); let finish;
  const response = await f.gateway.commitResourceSave(null, [...f.receipts.keys()][0]);
  f.gateway.commitResourceSave.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await f.click("Confirm save file"); f.preview.show([resources[1]], owner);
  finish(response); await flush();
  expect(document.body.textContent).not.toContain("Saved copy:");
  expect(document.body.textContent).toContain("These results have not been saved.");
});
it("rejects an inconsistent saved receipt without marking the output", async () => {
  const f = fixture(); await f.open(0);
  f.gateway.commitResourceSave.mockImplementation(async () => ({ schemaVersion: 1, profile: "resource.save.draft1", status: "saved", saved: true, replayed: false, receipt: { ...[...f.receipts.values()][0], contentVersion: "b".repeat(64) } }));
  await f.click("Confirm save file"); await f.click("Close");
  expect(document.body.textContent).not.toContain("Saved copy:");
});
