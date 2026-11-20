import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createFileDigestResult } from "./file-digest-result.js";

const profile = "resource.wasi.file-digest.v1", capabilityId = "devtools.files.hash";
const value = { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [
  { index: 0, bytes: 3, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: true },
  { index: 1, bytes: 0, sha256: "c".repeat(64), sha512: "d".repeat(128), matches: false },
] };
afterEach(() => { document.body.replaceChildren(); setLocale("zh-CN"); });
it("renders complete digest rows and retains selectable original output", () => {
  setLocale("en"); document.body.innerHTML = "<main><pre></pre></main>";
  const raw = document.querySelector("pre"), controller = createFileDigestResult({ raw, executionProfile: profile, capabilityId });
  raw.textContent = JSON.stringify(value); controller.show(value, ["C:\\private\\first.txt", "<img src=x onerror=alert(1)>\u202e.txt"], { expected: "a".repeat(64) });
  const panel = document.querySelector(".file-digest-result");
  expect(panel.hidden).toBe(false); expect(panel.textContent).toContain("Digest matches"); expect(panel.textContent).toContain("Digest does not match");
  expect([...panel.querySelectorAll("dd")].map(e => e.textContent)).toEqual([value.files[0].sha256,value.files[0].sha512,value.files[1].sha256,value.files[1].sha512]);
  expect(panel.querySelector("h4").textContent).toContain("first.txt");
  expect(panel.textContent).not.toContain("C:\\private"); expect(panel.querySelector("img")).toBeNull();
  expect(panel.textContent).not.toContain("\u202e");
  expect(JSON.parse(raw.textContent)).toEqual(value); expect(panel.querySelector("details").open).toBe(false);
  setLocale("zh-CN"); expect(panel.textContent).toContain("摘要一致"); expect(panel.textContent).toContain("摘要不一致");
  controller.destroy(); expect(raw.isConnected).toBe(true); expect(raw.hidden).toBe(false);
});
it("shows the raw error rather than presenting invalid input as a successful report", () => {
  document.body.innerHTML = "<main><pre></pre></main>";
  const raw = document.querySelector("pre"), controller = createFileDigestResult({ raw, executionProfile: profile, capabilityId });
  const failure = { ok: false, error: { code: "INVALID_REQUEST" } }; raw.textContent = JSON.stringify(failure); controller.show(failure);
  const panel = document.querySelector(".file-digest-result"); expect(panel.hidden).toBe(false); expect(panel.querySelector("details").open).toBe(true);
  expect(panel.querySelectorAll("dd")).toHaveLength(0); expect(JSON.parse(raw.textContent)).toEqual(failure);
  controller.clear(); expect(panel.hidden).toBe(true); controller.destroy();
});
it("does not affect unrelated tools", () => {
  document.body.innerHTML = "<pre></pre>"; const raw = document.querySelector("pre");
  expect(createFileDigestResult({ raw, executionProfile: "other", capabilityId })).toBeNull();
  expect(createFileDigestResult({ raw, executionProfile: profile, capabilityId: "other" })).toBeNull();
});
it("creates a draft only on explicit action and rejects stale completion", async () => {
  setLocale("en"); document.body.innerHTML = "<main><pre></pre></main>";
  let finish, isCurrent; const onNoteReport = vi.fn((value, names, input, current) => { isCurrent = current; return new Promise(resolve => { finish = resolve; }); });
  const controller = createFileDigestResult({ raw: document.querySelector("pre"), executionProfile: profile, capabilityId, onNoteReport });
  controller.show(value, ["one.txt", "two.txt"], { expected: "a".repeat(64) });
  const button = [...document.querySelectorAll("button")].find(el => el.textContent === "Create note draft");
  expect(onNoteReport).not.toHaveBeenCalled(); button.click(); expect(onNoteReport).toHaveBeenCalledOnce(); expect(button.disabled).toBe(true); expect(isCurrent()).toBe(true);
  controller.clear(); expect(isCurrent()).toBe(false); finish(); await Promise.resolve();
  expect(document.body.textContent).not.toContain("Report draft is in Notes recovery"); controller.destroy();
});
