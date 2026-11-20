import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createImageMetadataResult } from "./image-metadata-result.js";
const profile = "resource.wasi.image.metadata.v1", roots = [];
function counts(extra = {}) {
  return { format: "PNG", exif: 0, icc: 0, xmp: 0, text: 0, iptc: 0, other: 0,
    hasExifGpsDirectory: false, hasRecognizedMetadata: false, animation: false, ...extra };
}
function report(clean = false) {
  return { ok: true, operation: clean ? "clean" : "inspect", report: { schemaVersion: 2, material: "image-metadata-report",
    source: { bytes: 377, displayWidth: 7, displayHeight: 12, metadata: counts({ exif: 1, icc: 1, text: 3, other: 1, hasExifGpsDirectory: true, hasRecognizedMetadata: true }) },
    cleanedPreview: clean ? { bytes: 48007728, metadata: counts(), jpegQuality: null, kind: "encoded-preview", saved: null } : null } };
}
function fixture(clean = false) {
  setLocale("en"); document.body.innerHTML = '<main><pre class="tool-result"></pre></main>';
  const raw = document.querySelector("pre"), controller = createImageMetadataResult({ raw, executionProfile: profile,
    capabilityId: `devtools.image.metadata.${clean ? "clean" : "inspect"}` });
  roots.push(controller);
  const show = value => { raw.textContent = JSON.stringify(value); controller.show(value); };
  return { raw, controller, show, panel: document.querySelector(".image-metadata-result") };
}
afterEach(() => { for (const controller of roots.splice(0)) controller.destroy(); vi.restoreAllMocks(); document.body.replaceChildren(); setLocale("zh-CN"); });
describe("readable, scoped image metadata report", () => {
  it("summarizes orientation and detected categories while keeping the exact original report collapsed", () => {
    const f = fixture(), value = report(); f.show(value);
    expect(f.panel.hidden).toBe(false); expect(f.panel.querySelector("details").open).toBe(false);
    expect(f.panel.textContent).toContain("PNG · 7 × 12"); expect(f.panel.textContent).toContain("377 bytes");
    expect([...f.panel.querySelectorAll("li")].map(item => item.textContent)).toEqual(["EXIF · 1", "Color profile (ICC) · 1", "Text entries · 3", "Other metadata · 1", "GPS directory detected"]);
    expect(f.raw.textContent).toBe(JSON.stringify(value)); expect(f.raw.getAttribute("translate")).toBe("no");
    expect(JSON.parse(f.panel.querySelector("textarea").value)).toEqual(value.report);
    expect(JSON.parse(f.panel.querySelector("textarea").value)).not.toHaveProperty("ok");
    expect(f.panel.querySelector("p").textContent).toContain("Metadata was found");
  });
  it("shows complete copy bytes and leaves file actions to the existing explicit confirmation flow", () => {
    const f = fixture(true); f.show(report(true));
    expect(f.panel.textContent).toContain("48,007,728 bytes");
    expect(f.panel.textContent).toContain("The original image is unchanged");
    expect(f.panel.textContent).toContain("save the full copy separately");
    expect(f.panel.querySelectorAll("a,input")).toHaveLength(0);
    expect([...f.panel.querySelectorAll("button")].filter(button => !button.hidden).map(button => button.textContent)).toEqual(["Select entire report"]);
    expect([...f.panel.querySelectorAll("dt")].map(item => item.textContent)).not.toContain("JPEG quality used");
  });
  it("switches languages without closing details or replacing the readonly report editor and selection", () => {
    const f = fixture(true); f.show(report(true));
    const details = f.panel.querySelector("details"); details.open = true;
    const editor = f.panel.querySelector("textarea"); f.panel.querySelector("button").click();
    const before = editor.value, start = editor.selectionStart, end = editor.selectionEnd;
    expect(editor.readOnly).toBe(true); expect(end - start).toBe(before.length);
    setLocale("zh-CN");
    expect(details.open).toBe(true); expect(f.panel.querySelector("textarea")).toBe(editor); expect(editor.value).toBe(before);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([start, end]);
    expect(f.panel.querySelector("h3").textContent).toBe("图片元数据结果");
    expect(f.panel.querySelector("summary").textContent).toBe("查看原始报告");
    expect(f.panel.textContent).toContain("清理后副本大小");
    setLocale("en"); expect(f.panel.querySelector("h3").textContent).toBe("Image metadata result"); expect(details.open).toBe(true);
  });
  it("clears stale information and resets disclosure when a new image has no recognized metadata", () => {
    const f = fixture(); f.show(report()); f.panel.querySelector("details").open = true;
    f.controller.clear(); expect(f.panel.hidden).toBe(true); expect(f.raw.textContent).toBe("");
    const value = report(); value.report.source.metadata = counts(); f.show(value);
    expect(f.panel.querySelector("details").open).toBe(false); expect(f.panel.querySelectorAll("li")).toHaveLength(0);
    expect(f.panel.querySelector("p").textContent).toContain("No recognized metadata");
  });
  it("offers a separate confirmed save only for the current validated Host report", () => {
    setLocale("en"); document.body.innerHTML = '<main><pre class="tool-result"></pre></main>';
    const raw = document.querySelector("pre"), save = vi.fn(), resource = { resourceId: "report" }, owner = { pluginId: "p" };
    const controller = createImageMetadataResult({ raw, executionProfile: profile, capabilityId: "devtools.image.metadata.inspect", onSaveReport: save }); roots.push(controller);
    const value = report(); raw.textContent = JSON.stringify(value); controller.setReportResource(resource, owner); controller.show(value);
    const button = [...document.querySelectorAll("button")].find(item => item.textContent === "Save report");
    expect(button.hidden).toBe(false); expect(save).not.toHaveBeenCalled(); button.click();
    expect(save).toHaveBeenCalledWith(resource, owner, expect.any(HTMLElement));
    controller.clear(); expect(button.hidden).toBe(true);
    controller.setReportResource(resource, owner); controller.show({ ok: false, error: { code: "IMAGE_METADATA_FAILED" } }); expect(button.hidden).toBe(true);
    controller.clear(); raw.textContent = JSON.stringify(value); controller.show(value);
    expect(button.hidden).toBe(true); expect(document.querySelector(".image-metadata-result").textContent).toContain("still select and copy the report");
    expect(JSON.parse(document.querySelector(".image-metadata-result textarea").value)).toEqual(value.report);
  });
  it("creates a note draft only on a single explicit click and invalidates stale requests", async () => {
    setLocale("en"); document.body.innerHTML = '<main><pre></pre></main>';
    let resolve; const pending = new Promise(done => { resolve = done; });
    const receive = vi.fn(() => pending), raw = document.querySelector("pre"), resource = { resourceId: "report" }, owner = { capabilityId: "devtools.image.metadata.inspect" };
    const controller = createImageMetadataResult({ raw, executionProfile: profile, capabilityId: owner.capabilityId, onNoteReport: receive }); roots.push(controller);
    controller.setReportResource(resource, owner); controller.show(report());
    const button = [...document.querySelectorAll("button")].find(item => item.textContent === "Create note draft");
    expect(receive).not.toHaveBeenCalled(); button.click(); button.click();
    expect(receive).toHaveBeenCalledTimes(1); const current = receive.mock.calls[0][2]; expect(current()).toBe(true);
    controller.clear(); expect(current()).toBe(false); resolve(); await pending; await Promise.resolve();
    expect(button.hidden).toBe(true); expect(document.querySelector('[role="status"]').textContent).toBe("");
  });
  it("renders JPEG quality only for a validated JPEG copy", () => {
    const f = fixture(true), value = report(true); value.report.source.metadata.format = "JPEG";
    value.report.cleanedPreview.metadata.format = "JPEG"; value.report.cleanedPreview.jpegQuality = 85; f.show(value);
    expect(f.panel.textContent).toContain("JPEG quality used85");
  });
  it.each([
    value => { value.report.source.displayWidth = 12001; },
    value => { value.report.source.metadata.exif = -1; },
    value => { value.report.source.metadata.hasRecognizedMetadata = false; },
    value => { value.report.cleanedPreview.metadata.exif = 1; },
    value => { value.report.cleanedPreview.bytes = 128 * 1024 * 1024 + 1; },
    value => { value.report.source.metadata.format = '<img src="private">'; },
  ])("does not invent a success summary for an invalid or mismatched report", mutate => {
    const f = fixture(true), value = report(true); mutate(value); f.show(value);
    expect(f.panel.querySelector("p").textContent).toContain("cannot be summarized");
    expect(f.panel.querySelectorAll("dl > div,li,img")).toHaveLength(0);
    expect(f.raw.textContent).toBe(JSON.stringify(value));
  });
  it("shows a fixed business-error explanation and keeps untrusted diagnostics only as escaped raw text", () => {
    const f = fixture(), error = { ok: false, error: { code: "IMAGE_METADATA_FAILED", message: '<script>private</script>' } }; f.show(error);
    expect(f.panel.querySelector("p").textContent).toContain("could not be processed"); expect(f.panel.querySelector("script")).toBeNull();
    expect(JSON.parse(f.panel.querySelector("textarea").value)).toEqual(error);
    expect(f.panel.querySelector("details").open).toBe(false);
  });
  it("does not affect another plugin profile and removes its locale subscription on destruction", () => {
    const f = fixture(), remove = vi.spyOn(window, "removeEventListener");
    for (const options of [{ executionProfile: "compute.wasi.v1", capabilityId: "devtools.image.metadata.inspect" },
      { executionProfile: profile, capabilityId: "another.capability" }]) expect(createImageMetadataResult({ raw: f.raw, ...options })).toBeNull();
    f.controller.destroy(); expect(document.querySelector(".image-metadata-result")).toBeNull(); expect(document.querySelector("main > pre")).toBe(f.raw);
    expect(remove).toHaveBeenCalledWith("zicode:locale-changed", expect.any(Function));
  });
});
