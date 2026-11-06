import { describe, expect, it } from "vitest";
import { normalizeResourceOutputs, normalizeHostMetadataReport } from "./plugin-resource-outputs.js";
const source = { resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", contentVersion: "a".repeat(64) };
const row = () => ({ index: 0, resourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", contentVersion: "b".repeat(64),
  mimeType: "image/png", byteLength: 42, expiresInSeconds: 900, origin: "worker-output", saved: false, derivedFrom: { ...source } });
const reply = (resources = [row()]) => ({ outputProfile: "resource.wasi.output.draft1", resources });
describe("resource output reference boundary", () => {
  it("accepts only bounded Host-generated metadata reports tied to the exact input", () => {
    const output = { ...row(), resourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    const report = { ...row(), profile: "resource.host.image-metadata-report.draft1", mimeType: "application/json", origin: "host-report" };
    const response = { result: { ok: true }, resources: [output], reportResource: report };
    expect(normalizeHostMetadataReport(response, source, "resource.wasi.image.metadata.v1")).toMatchObject({ mimeType: "application/json", resourceId: report.resourceId });
    expect(normalizeHostMetadataReport({ result: { ok: true } }, source, "resource.wasi.image.metadata.v1")).toBeNull();
    for (const extra of [{ resourceId: output.resourceId }, { origin: "worker-output" }, { mimeType: "text/plain" }, { byteLength: 48 * 1024 + 1 },
      { derivedFrom: { ...source, contentVersion: "c".repeat(64) } }, { saved: true }])
      expect(() => normalizeHostMetadataReport({ ...response, reportResource: { ...report, ...extra } }, source, "resource.wasi.image.metadata.v1")).toThrow("resource_response_invalid");
    expect(() => normalizeHostMetadataReport(response, source, "resource.wasi.input.draft2")).toThrow("resource_response_invalid");
  });
  it("binds Markdown success to one complete HTML output and rejects missing negotiation, mismatched length and partial failures", () => {
    const owner={...source,capabilityId:"devtools.markdown.render"},profile="resource.wasi.markdown.v1";
    const html={...row(),mimeType:"text/html",byteLength:10486640};
    const success={...reply([html]),result:{ok:true,inputBytes:2097152,utf8Bytes:2097152,htmlBytes:10486640,eventCount:3,mimeType:"text/html",sourceUnchanged:true}};
    expect(normalizeResourceOutputs(success,owner,profile)[0]).toMatchObject({mimeType:"text/html",byteLength:10486640,outputLabel:"HTML document"});
    for(const value of [{result:success.result},{...success,resources:[]},{...success,resources:[{...html,mimeType:"text/plain"}]},
      {...success,result:{...success.result,htmlBytes:1}},{...success,result:{...success.result,eventCount:200001}},
      {...success,result:{...success.result,ok:false}},{...success,result:{...success.result,sourceUnchanged:false}}])
      expect(()=>normalizeResourceOutputs(value,owner,profile)).toThrow("resource_response_invalid");
    expect(normalizeResourceOutputs({result:{ok:false,error:{code:"MARKDOWN_FAILED"}}},owner,profile)).toBeNull();
  });
  it("preserves legacy and strips every unknown field from valid references", () => {
    expect(normalizeResourceOutputs({}, source)).toBeNull();
    const value = row(); value.path = "private"; value.derivedFrom.token = "secret";
    expect(normalizeResourceOutputs(reply([value]), source)).toEqual([row()]);
    expect(normalizeResourceOutputs(reply([]), source)).toEqual([]);
  });
  it("accepts an archive resource without trusting a path or filename", () => {
    const value = { ...row(), mimeType: "application/x-zicode-archive-targzip", path: "C:/private", filename: "evil.exe" };
    const result = normalizeResourceOutputs(reply([value]), source);
    expect(result[0].mimeType).toBe(value.mimeType);
    expect(result[0]).not.toHaveProperty("path");
    expect(result[0]).not.toHaveProperty("filename");
  });
  it("rejects profile mismatch and incomplete output declarations", () => {
    for (const value of [{ resources: [] }, { outputProfile: "resource.wasi.output.draft1" },
      { ...reply(), outputProfile: "resource.v1" }, reply({})])
      expect(() => normalizeResourceOutputs(value, source)).toThrow("resource_response_invalid");
  });
  it("rejects source substitution, invalid budgets, MIME, UUID and state", () => {
    for (const extra of [{ index: 1 }, { resourceId: source.resourceId }, { contentVersion: "B".repeat(64) },
      { mimeType: "application/javascript" }, { byteLength: -1 }, { byteLength: 32 * 1024 * 1024 + 1 },
      { expiresInSeconds: 901 }, { expiresInSeconds: 0 }, { saved: true }, { origin: "upload" },
      { derivedFrom: { ...source, contentVersion: "c".repeat(64) } }])
      expect(() => normalizeResourceOutputs(reply([{ ...row(), ...extra }]), source)).toThrow("resource_response_invalid");
  });
  it("bounds aggregate bytes and rejects repeated output IDs", () => {
    const second = { ...row(), index: 1, resourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
    expect(() => normalizeResourceOutputs(reply([row(), { ...row(), index: 1 }]), source)).toThrow();
    expect(() => normalizeResourceOutputs(reply([{ ...row(), byteLength: 32 * 1024 * 1024 }, second]), source)).toThrow();
  });
  it("keeps all declared input ancestors and rejects substituted ones", () => {
    const multi = { ...source, additionalResources: [{ resourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", contentVersion: "c".repeat(64) }] };
    const output = { ...row(), derivedFromAll: [source, multi.additionalResources[0]] };
    expect(normalizeResourceOutputs(reply([output]), multi)[0].derivedFromAll).toEqual(output.derivedFromAll);
    expect(() => normalizeResourceOutputs(reply([row()]), multi)).toThrow("resource_response_invalid");
    expect(() => normalizeResourceOutputs(reply([{ ...output, derivedFromAll: [...output.derivedFromAll].reverse() }]), multi)).toThrow("resource_response_invalid");
  });
});
