import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createFileDigestManifestReview } from "./file-digest-manifest-review.js";
const hash = "a".repeat(64), callId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revision = "b".repeat(64);
const source = { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [{ index: 0, sha256: hash }] };
const roots = [];
function fixture() {
  setLocale("en"); document.body.innerHTML = "<main></main>";
  const gateway = { callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", prepareRequired: true })),
    searchTools: vi.fn(async () => ({ schemaVersion: 1, revision, items: [{ pluginId: "com.zicode.devtools.checksum-manifest", capabilityId: "devtools.checksum-manifest.review", version: "0.1.0", enabled: true, runtime: "wasi" }] })),
    loadTool: vi.fn(async (_scene, { pluginId, capabilityId }) => ({ pluginId, capability: { id: capabilityId }, revision, version: "0.1.0" })),
    prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId })), cancelCall: vi.fn(async () => ({})),
    invoke: vi.fn(async () => ({ result: { contractVersion: "1.0.0-rc.1", ok: true, data: { text: JSON.stringify({ schemaVersion: 1, entries: [{ name: "a.txt", expected: hash, status: "match" }] }) } } })),
  };
  const verifySources = vi.fn(async current => { if (!current()) throw new Error(); }), onBusy = vi.fn();
  const controller = createFileDigestManifestReview({ container: document.querySelector("main"), gateway, getTarget: () => ({ workspaceId: "w", sceneId: "programming" }), isCurrent: () => true, verifySources, onBusy }); roots.push(controller);
  controller.show(source, ["a.txt"]); const input = document.querySelector("textarea"), button = [...document.querySelectorAll("button")].find(el => el.textContent === "Review manifest with these files");
  input.value = `${hash}  a.txt\n`; input.dispatchEvent(new Event("input"));
  return { controller, gateway, verifySources, onBusy, button, input };
}
afterEach(() => { for (const r of roots.splice(0)) r.destroy(); document.body.replaceChildren(); setLocale("zh-CN"); });
it("sends the exact Host-derived names/hashes only on explicit review and checks permission twice", async () => {
  const f = fixture(); expect(f.gateway.invoke).not.toHaveBeenCalled(); f.button.click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Manifest review completed"));
  expect(f.gateway.invoke.mock.calls[0][4].files).toEqual([{ name: "a.txt", sha256: hash }]); expect(f.verifySources).toHaveBeenCalledTimes(2);
  setLocale("zh-CN"); expect(document.body.textContent).toContain("摘要一致"); expect(document.body.textContent).toContain("清单核对完成");
});
it("rejects access loss and keeps late responses from presenting a stale review", async () => {
  const f = fixture(); let finish; f.gateway.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; })); f.button.click();
  await vi.waitFor(() => expect(f.gateway.invoke).toHaveBeenCalledOnce()); f.controller.clear(); finish({ result: { ok: false } });
  await vi.waitFor(() => expect(f.onBusy).toHaveBeenLastCalledWith(false)); expect(document.body.textContent).not.toContain("Manifest review completed");
  const g = fixture(); g.verifySources.mockRejectedValue(new Error("revoked")); g.button.click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Manifest review failed")); expect(g.gateway.invoke).not.toHaveBeenCalled();
});
it("keeps an uncertain call locked with recovery controls", async () => {
  const f = fixture(); f.gateway.invoke.mockRejectedValue(Object.assign(new Error(), { code: "plugin_capability_timeout" })); f.button.click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Tool result is unknown")); expect(f.button.disabled).toBe(true);
  expect(f.gateway.cancelCall).toHaveBeenCalledOnce();
});
it("loads a manifest file without automatically invoking the reviewer", async () => {
  const f = fixture(), bytes = new TextEncoder().encode(`${hash}  a.txt\n\n`), file = { name: "SHA256SUMS", size: bytes.length, arrayBuffer: vi.fn(async () => bytes.buffer) };
  const picker = document.querySelector(".manifest-file-input input"); Object.defineProperty(picker, "files", { value: [file] }); picker.dispatchEvent(new Event("change"));
  expect(file.arrayBuffer).not.toHaveBeenCalled(); document.querySelector(".manifest-file-input button").click();
  await vi.waitFor(() => expect(f.input.value).toBe(`${hash}  a.txt\n\n`)); expect(f.gateway.invoke).not.toHaveBeenCalled();
  expect(f.input.disabled).toBe(false); expect(f.button.disabled).toBe(false);
  f.button.click(); await vi.waitFor(() => expect(document.body.textContent).toContain("Manifest review completed"));
  expect(document.body.textContent).not.toContain("Review has not run yet");
});
