import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createDirectoryResourceRunner } from "./directory-resource-runner.js";
import { admission, reconciliation } from "../../../tests/helpers/resource-call-admission.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roots = [];
function fixture(overrides = {}, maxResources = 1, directory = false, receiver = null, receiveNoteDraft = undefined) {
  setLocale("en"); vi.stubGlobal("crypto", webcrypto); document.body.innerHTML = "<main></main>";
  let target = { instanceId: "runtime", sessionId: "session", workspaceId: "workspace", sceneId: "programming" };
  const tool = { pluginId: "receiver", capabilityId: "consume", title: "Consume", applicationName: "Receiver", version: "1", runtime: "wasi", ...receiver };
  const profile = receiver?.resourceInputProfile ?? "resource.wasi.input.draft2";
  const detail = { pluginId: tool.pluginId, version: "1", revision: "a".repeat(64), enabled: true, resourceInputProfile: profile, capability: { id: tool.capabilityId, inputSchema: {}, ...(receiver?.executionProfile ? { executionProfile: receiver.executionProfile } : {}), ...(receiver?.resourceInputMimeTypes ? { resourceInputMimeTypes: receiver.resourceInputMimeTypes } : {}), ...(maxResources > 1 ? { resourceInputMax: maxResources } : {}) }, permissions: [{ name: "resource.read", granted: true }, ...(directory ? [{ name: "resource.directory.read", granted: true }] : [])] };
  if (receiver?.nativeDigestStream) detail.nativeDigestStream = true;
  const gateway = { loadTool: vi.fn(async () => detail), prepareResource: vi.fn(async () => ({ resourceId: id })), appendResource: vi.fn(async () => ({ uploadedBytes: 3 })), commitResource: vi.fn(async access => ({ ...access, confirmed: true, byteLength: 3 })), revokeResource: vi.fn(async () => ({})), readResource: vi.fn(async () => ({})), cancelResource: vi.fn(async () => ({ schemaVersion: 1, status: "requested", executionFinished: false })),
    invokeResource: vi.fn(async (owner, request) => ({ schemaVersion: 1, operationId: id, source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile }, result: { text: "received <script>literal</script>" } })), ...overrides };
  gateway.resourceCalls = { keep: vi.fn(async (target, owner, ticket) => ({ target, owner, ticket })), remove: vi.fn(async () => {}) };
  gateway.prepareResourceCall = vi.fn(async owner => admission(owner));
  gateway.reconcileResourceCall = vi.fn(async (owner, ticket) => reconciliation(owner, ticket.callId));
  gateway.invokeResourceCall = gateway.invokeResource;
  const form = { prepare: vi.fn(() => ({ input: { count: 0, flag: false } })), setDisabled: vi.fn(), destroy: vi.fn() };
  const onBusy = vi.fn(), onSuccess = vi.fn(async () => {});
  const controller = createDirectoryResourceRunner({ container: document.querySelector("main"), tool, detail, gateway, getTarget: () => target, onBusy, onSuccess, receiveNoteDraft, mountInputs: async () => form }); roots.push(controller);
  const button = name => [...document.querySelectorAll("button")].find(b => b.textContent === name);
  async function share() {
    const file = { name: "input.txt", size: 3, type: "text/plain", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    const input = document.querySelector('input[type="file"]'); Object.defineProperty(input, "files", { value: [file] }); input.dispatchEvent(new Event("change"));
    button("Confirm file sharing").click(); await vi.waitFor(() => expect(button("Execute tool").disabled).toBe(false));
  }
  return { gateway, form, onBusy, onSuccess, controller, button, share, switchTarget: () => { target = { ...target, sessionId: "other" }; } };
}
function streamingFixture() {
  const receiver = { pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash",
    executionProfile: "resource.wasi.file-digest.v1", nativeDigestStream: true };
  const owner = { runtimeId: "runtime", sessionId: "session", pluginId: receiver.pluginId, capabilityId: receiver.capabilityId };
  const profile = "resource.local-file.digest-stream.draft1", reportId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const files = Array.from({ length: 5 }, (_, index) => ({ name: `file-${index}.txt`, byteLength: index ? index : 96 * 1024 * 1024 }));
  const totalBytes = files.reduce((sum, file) => sum + file.byteLength, 0), contentVersion = "c".repeat(64);
  const reportAccess = { schemaVersion: 1, owner, resourceId: reportId, contentVersion };
  const reply = { schemaVersion: 1, profile, reportAccess,
    result: { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: files.map((file, index) => ({ index, bytes: file.byteLength, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: null })) },
    reportResource: { profile: "resource.host.file-digest-stream-report.draft1", index: 0, resourceId: reportId, contentVersion, mimeType: "application/json", byteLength: 750, origin: "host-report", saved: false } };
  const api = {
    choose: vi.fn(async () => ({ schemaVersion: 1, profile, grantId: id, owner, contentRead: false, confirmed: false, files, totalBytes })),
    progress: vi.fn(async () => ({ schemaVersion: 1, profile, grantId: id, fileCount: 5, completedFiles: 0, bytesRead: 65536, totalBytes })),
    run: vi.fn(async () => reply), cancel: vi.fn(async () => {}),
    original: vi.fn(async () => ({ schemaVersion: 1, contentRead: false, mimeType: "application/octet-stream", fileName: files[1].name, byteLength: files[1].byteLength,
      access: { schemaVersion: 1, owner, resourceId: id, contentVersion: "a".repeat(64) } })),
  };
  const searchTools = vi.fn(async () => ({ schemaVersion: 1, revision: "a".repeat(64), offset: 0, nextOffset: null, items: [] }));
  const prepareResourceSave = vi.fn(async () => ({})), commitResourceSave = vi.fn(async () => ({}));
  const f = fixture({ digestStreams: api, searchTools, prepareResourceTransfer: vi.fn(), prepareResourceSave, commitResourceSave }, 4, false, receiver);
  f.form.prepare.mockReturnValue({ input: {} });
  return { f, files, api, owner, reply };
}
afterEach(() => { for (const root of roots.splice(0)) root.destroy(); vi.unstubAllGlobals(); document.body.innerHTML = ""; setLocale("zh-CN"); });
describe("directory-owned resource execution", () => {
  it("runs native streaming from the existing browse action and offers save and original relay", async () => {
    const { f, files, api, owner, reply } = streamingFixture();
    let finish;
    api.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    f.button("Browse local files").click();
    await vi.waitFor(() => expect(document.querySelectorAll(".plugin-resource-file-list li")).toHaveLength(files.length));
    expect(api.run).not.toHaveBeenCalled();
    f.button("Confirm file sharing").click();
    await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false));
    expect(api.run).not.toHaveBeenCalled();
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(document.querySelector("progress")?.value).toBe(65536));
    expect(api.run).toHaveBeenCalledWith("workspace", owner, id, "");
    finish(reply);
    await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(document.querySelector("progress")).toBeNull();
    expect(f.button("Execute tool").disabled).toBe(true);
    expect(document.querySelectorAll(".file-digest-result h4")).toHaveLength(files.length);
    expect(document.querySelectorAll(".file-digest-result button").length).toBeGreaterThanOrEqual(4);
    expect(f.gateway.invokeResource).not.toHaveBeenCalled();

    f.button("Preview save").click();
    await vi.waitFor(() => expect(f.gateway.prepareResourceSave).toHaveBeenCalledWith(reply.reportAccess));
    expect(f.gateway.commitResourceSave).not.toHaveBeenCalled();
    f.button("Cancel save").click();
    f.button("Send original file").click();
    await vi.waitFor(() => expect(api.original).toHaveBeenCalledWith("workspace", reply.reportAccess, 1));
    await vi.waitFor(() => expect(f.gateway.searchTools).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({resourceMimeType:"application/octet-stream"}), expect.anything()));
    expect(f.gateway.prepareResourceTransfer).not.toHaveBeenCalled();
    f.button("Close transfer").click();
    f.button("Cancel file sharing").click();
    expect(f.gateway.revokeResource).toHaveBeenCalledWith(reply.reportAccess);
    expect(f.button("Preview save")).toBeUndefined();
  });

  it("suppresses and revokes a late stream report after cancelling", async () => {
    const { f, api, reply } = streamingFixture();
    let finish;
    api.run.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    f.button("Browse local files").click();
    await vi.waitFor(() => expect(f.button("Confirm file sharing").disabled).toBe(false));
    f.button("Confirm file sharing").click();
    await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false));
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(api.run).toHaveBeenCalledOnce());
    f.button("Cancel tool").click();
    await vi.waitFor(() => expect(api.cancel).toHaveBeenCalledOnce());
    finish(reply);
    await vi.waitFor(() => expect(f.gateway.revokeResource).toHaveBeenCalledWith(reply.reportAccess));
    expect(f.onSuccess).not.toHaveBeenCalled();
    expect(document.querySelector("progress")).toBeNull();
    expect(f.button("Preview save")).toBeUndefined();
  });
  it("does not stage a draft when the file grant is revoked", async () => {
    const received = vi.fn();
    const f = fixture({}, 1, false, { pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash", executionProfile: "resource.wasi.file-digest.v1" }, received);
    f.gateway.readResource.mockRejectedValue({ code: "permission_denied" });
    f.gateway.invokeResource.mockImplementation(async (owner, request) => ({ schemaVersion: 1, operationId: id,
      source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile: "resource.wasi.input.draft2" },
      result: { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [{ index: 0, bytes: 3, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: null }] } }));
    await f.share(); f.button("Execute tool").click(); await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    f.button("Create note draft").click(); await vi.waitFor(() => expect(document.body.textContent).toContain("Could not create the note draft"));
    expect(received).not.toHaveBeenCalled();
  });
  it("rechecks access before and after staging a digest draft", async () => {
    const received = vi.fn(async (_material, current, verify) => { expect(current()).toBe(true); await verify(); });
    const f = fixture({}, 1, false, { pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash", executionProfile: "resource.wasi.file-digest.v1" }, received);
    f.gateway.readResource.mockImplementation(async (_owner, request) => ({ schemaVersion: 1, ...request, byteLength: 1, eof: false, dataBase64: "AQ==" }));
    f.gateway.invokeResource.mockImplementation(async (owner, request) => ({ schemaVersion: 1, operationId: id,
      source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile: "resource.wasi.input.draft2" },
      result: { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [{ index: 0, bytes: 3, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: null }] } }));
    await f.share(); f.button("Execute tool").click(); await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    f.button("Create note draft").click(); await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(f.gateway.readResource).toHaveBeenCalledTimes(2));
    expect(received.mock.calls[0][0].content).toContain("a".repeat(64));
    await vi.waitFor(() => expect(document.body.textContent).toContain("Report draft is in Notes recovery"));
  });

  it("offers an authorized digest report to the existing receiver picker and clears it with the source", async () => {
    const searchTools = vi.fn(async () => ({ schemaVersion: 1, revision: "a".repeat(64), total: 0, items: [] }));
    const f = fixture({ prepareResourceTransfer: vi.fn(), searchTools }, 1, false,
      { pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash", executionProfile: "resource.wasi.file-digest.v1" });
    const reportId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    f.gateway.invokeResource.mockImplementation(async (owner, request) => ({ schemaVersion: 1, operationId: id,
      source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile: "resource.wasi.input.draft2" },
      outputProfile: "resource.wasi.output.draft1", resources: [],
      result: { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [
        { index: 0, bytes: 3, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: null }] },
      reportResource: { index: 0, resourceId: reportId, contentVersion: "c".repeat(64), profile: "resource.host.file-digest-report.draft1",
        mimeType: "application/json", byteLength: 320, expiresInSeconds: 900, origin: "host-report", saved: false,
        derivedFrom: { resourceId: request.resourceId, contentVersion: request.contentVersion } } }));
    await f.share(); f.button("Execute tool").click(); await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(searchTools).not.toHaveBeenCalled();
    f.button("Send to tool").click();
    await vi.waitFor(() => expect(searchTools).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ resourceMimeType: "application/json" }), expect.anything()));
    expect(f.gateway.prepareResourceTransfer).not.toHaveBeenCalled();
    f.button("Cancel file sharing").click();
    expect(document.querySelector(".plugin-resource-transfer")).toBeNull();
    expect(f.button("Send to tool")).toBeUndefined();
  });

  it("uses the byte-verified report with provenance when creating a Notes draft", async () => {
    const received = vi.fn(async (_material, current, verify) => { expect(current()).toBe(true); await verify(); });
    const f = fixture({}, 1, false, { pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash",
      executionProfile: "resource.wasi.file-digest.v1" }, received);
    const reportId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const digest = { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [
      { index: 0, bytes: 3, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: null }] };
    const published = { ...digest, files: [{ ...digest.files[0], name: "来源.txt" }], packageVersion: "0.1.0",
      generatedBy: { toolId: "files", toolVersion: "1.2.0", runtimeFingerprint: { appVersion: "0.6.3" } } };
    const bytes = Buffer.from(JSON.stringify(published, null, 2)), version = createHash("sha256").update(bytes).digest("hex");
    f.gateway.readResource.mockImplementation(async (owner, request) => {
      expect(owner.capabilityId).toBe("devtools.files.hash");
      expect(request.resourceId).toBe(reportId);
      const chunk = bytes.subarray(request.offset, request.offset + request.length);
      return { schemaVersion: 1, ...request, byteLength: chunk.length, eof: request.offset + chunk.length === bytes.length,
        dataBase64: chunk.toString("base64") };
    });
    f.gateway.invokeResource.mockImplementation(async (owner, request) => ({ schemaVersion: 1, operationId: id,
      source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile: "resource.wasi.input.draft2" },
      outputProfile: "resource.wasi.output.draft1", resources: [], result: digest,
      reportResource: { index: 0, resourceId: reportId, contentVersion: version, profile: "resource.host.file-digest-report.draft1",
        mimeType: "application/json", byteLength: bytes.length, expiresInSeconds: 900, origin: "host-report", saved: false,
        derivedFrom: { resourceId: request.resourceId, contentVersion: request.contentVersion } } }));
    await f.share(); f.button("Execute tool").click(); await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(f.gateway.prepareResource).toHaveBeenCalledWith(expect.objectContaining({ fileName: "input.txt" }));
    f.button("Create note draft").click();
    await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
    expect(received.mock.calls[0][0].content).toContain(bytes.toString("utf8"));
    expect(f.gateway.readResource).toHaveBeenCalledTimes(3);
  });

  it("opens the same relay for an original file from a successful native selection", async () => {
    const resourceOwner = { runtimeId: "runtime", sessionId: "session", pluginId: "com.zicode.devtools.files", capabilityId: "devtools.files.hash" };
    const projectFiles = { entries: vi.fn(async () => ["样本.txt"]), prepare: vi.fn(async () => ({
      profile: "resource.local-file.draft1", grantId: id, relativePath: "样本.txt", byteLength: 3,
      owner: resourceOwner, contentRead: false, confirmed: false,
    })), commit: vi.fn(async () => ({ profile: "resource.local-file.draft1", confirmed: true, byteLength: 3,
      resourceId: id, contentVersion: "a".repeat(64), access: { owner: resourceOwner, resourceId: id, contentVersion: "a".repeat(64) },
      originalFile: { name: "样本.txt", byteLength: 3 },
    })), cancel: vi.fn(async () => {}) };
    const searchTools = vi.fn(async () => ({ schemaVersion: 1, revision: "a".repeat(64), offset: 0, nextOffset: null, items: [] }));
    const f = fixture({ projectFiles, prepareResourceTransfer: vi.fn(), searchTools }, 4, false,
      { pluginId: resourceOwner.pluginId, capabilityId: resourceOwner.capabilityId, executionProfile: "resource.wasi.file-digest.v1" });
    f.gateway.invokeResource.mockImplementation(async (owner, request) => ({ schemaVersion: 1, operationId: id,
      source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile: "resource.wasi.input.draft2" },
      result: { ok: true, schemaVersion: 2, material: "file-integrity-report-list", files: [
        { index: 0, bytes: 3, sha256: "a".repeat(64), sha512: "b".repeat(128), matches: null }] } }));
    await vi.waitFor(() => expect(f.button("Use opened file: 样本.txt")).toBeTruthy());
    f.button("Use opened file: 样本.txt").click();
    await vi.waitFor(() => expect(f.button("Confirm file sharing").disabled).toBe(false));
    f.button("Confirm file sharing").click();
    await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false));
    expect(f.button("Send original file")).toBeUndefined();
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.button("Send original file")).toBeTruthy());
    f.button("Send original file").click();
    await vi.waitFor(() => expect(searchTools).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      resourceMimeType: "application/octet-stream", pluginId: "com.zicode.devtools.encoding",
    }), expect.anything()));
    f.button("Close transfer").click();
    expect(f.button("Send original file")).toBeTruthy();
    expect(f.gateway.prepareResourceTransfer).not.toHaveBeenCalled();
    expect(f.gateway.invokeResourceCall).toHaveBeenCalledOnce();
  });

  it("renders the negotiated metadata report and clears it when sharing is cancelled", async () => {
    const f = fixture({}, 1, false, { pluginId: "com.zicode.devtools.image.metadata", capabilityId: "devtools.image.metadata.inspect", executionProfile: "resource.wasi.image.metadata.v1" });
    f.gateway.invokeResource.mockImplementation(async (owner, request) => ({ schemaVersion: 1, operationId: id,
      source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile: "resource.wasi.input.draft2" },
      outputProfile: "resource.wasi.output.draft2", result: { ok: true, operation: "inspect", previewIndex: 0,
        report: { schemaVersion: 2, material: "image-metadata-report", cleanedPreview: null,
          source: { bytes: 3, displayWidth: 7, displayHeight: 12, metadata: { format: "PNG", exif: 0, icc: 0, xmp: 0, text: 0, iptc: 0, other: 0, animation: false, hasExifGpsDirectory: false, hasRecognizedMetadata: false } } } },
      resources: [{ index: 0, resourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", contentVersion: "b".repeat(64), mimeType: "image/png", byteLength: 100,
        expiresInSeconds: 900, origin: "worker-output", saved: false, derivedFrom: { resourceId: request.resourceId, contentVersion: request.contentVersion } }] }));
    await f.share(); f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(document.querySelector(".image-metadata-result").hidden).toBe(false);
    expect(document.querySelector(".image-metadata-result").textContent).toContain("PNG · 7 × 12");
    expect(document.querySelector(".image-metadata-result details").open).toBe(false);
    f.button("Cancel file sharing").click();
    expect(document.querySelector(".image-metadata-result").hidden).toBe(true);
    expect(document.querySelector("pre.tool-result").textContent).toBe("");
  });
  it.each([
    ["inspect", "resource.wasi.encoding-inspect.v1"],
    ["to_utf8", "resource.wasi.encoding-utf8.v1"],
    ["convert", "resource.wasi.encoding-convert.v1"],
  ])("caps full encoding %s at eight MiB before any file bytes are read", async (operation, executionProfile) => {
    const f = fixture({}, 1, false, { pluginId: "com.zicode.devtools.encoding", capabilityId: `devtools.encoding.${operation}`, executionProfile });
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const input = document.querySelector('input[type="file"]');
    const select = size => {
      Object.defineProperty(input, "files", { configurable: true, value: [{ name: "fixture.txt", size, type: "text/plain", arrayBuffer }] });
      input.dispatchEvent(new Event("change"));
    };
    select(8 * 1024 * 1024 + 1);
    expect(f.button("Confirm file sharing").disabled).toBe(true);
    expect(document.body.textContent).toContain("Choose a file up to 8 MiB");
    select(8 * 1024 * 1024);
    expect(f.button("Confirm file sharing").disabled).toBe(false);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(f.gateway.prepareResource).not.toHaveBeenCalled();
  });

  it("shows declared input MIME types and explains a mismatched file without losing recovery", async () => {
    const f = fixture({}, 1, false, { resourceInputMimeTypes: ["text/plain"] });
    expect(document.body.textContent).toContain("Accepted file types: text/plain");
    await f.share();
    f.gateway.invokeResource.mockRejectedValue({ code: "resource_input_type_unsupported" });
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("does not accept the shared file type"));
    expect(document.body.textContent).toContain("Stop and recover call");
    expect(f.button("Stop and recover call").hidden).toBe(false);
  });
  it("explains invalid resource input while keeping uncertain calls locked", async () => {
    const f = fixture(); await f.share();
    f.gateway.invokeResource.mockRejectedValue({ code: "resource_input_invalid", message: "private E:\\secret" });
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.button("Stop and recover call").hidden).toBe(false));
    expect(document.body.textContent).toContain("This resource is invalid or exceeds the receiver's format or size limits.");
    expect(document.body.textContent).toContain("Execution outcome is unknown");
    expect(document.body.textContent).not.toContain("E:\\secret");
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("runs only the fixed built-in Host image, OCR and text receivers after explicit file confirmation", async () => {
    for (const receiver of [
      { pluginId: "com.zicode.resource-inspector", capabilityId: "image.inspect", resourceInputProfile: "resource.host.image-input.v1" },
      { pluginId: "com.zicode.ocr", capabilityId: "ocr.resource-text", resourceInputProfile: "resource.host.ocr-input.v1" },
      { pluginId: "com.zicode.text-inspector", capabilityId: "text.inspect", resourceInputProfile: "resource.host.text-input.v1" },
    ]) {
      const f = fixture({}, 1, false, { ...receiver, runtime: "builtin" });
      await f.share();
      expect(f.gateway.invokeResource).not.toHaveBeenCalled();
      f.button("Execute tool").click();
      await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
      expect(f.gateway.invokeResource.mock.calls[0][0]).toMatchObject({ pluginId: receiver.pluginId, capabilityId: receiver.capabilityId });
      f.controller.destroy();
    }
    const unknown = fixture({}, 1, false, { pluginId: "other", capabilityId: "resource.read", resourceInputProfile: "resource.host.text-input.v1", runtime: "builtin" });
    expect(document.body.textContent).toContain("Resource tool unavailable");
    expect(unknown.gateway.prepareResource).not.toHaveBeenCalled();
  });
  it("requires separate directory selection, sharing confirmation and execution", async () => {
    const owner = { runtimeId: "runtime", sessionId: "session", pluginId: "receiver", capabilityId: "consume" };
    const serializedOwner = { capabilityId: "consume", pluginId: "receiver", runtimeId: "runtime", sessionId: "session" };
    const projectDirectories = {
      choose: vi.fn(async () => "src"),
      prepare: vi.fn(async () => ({ profile: "resource.local-directory.draft1", confirmed: false, entryNamesRead: false, relativePath: "src", owner: serializedOwner, grantId: id })),
      commit: vi.fn(async () => ({ profile: "resource.local-directory.draft1", confirmed: true, entryCount: 2, access: { schemaVersion: 1, owner: serializedOwner, resourceId: id, contentVersion: "a".repeat(64) } })),
      cancel: vi.fn(async () => ({})),
    };
    const f = fixture({ projectDirectories }, 1, true);
    expect(f.button("Folder")).toBeTruthy();
    f.button("Folder").click();
    expect(projectDirectories.choose).not.toHaveBeenCalled();
    f.button("Choose a folder").click();
    await vi.waitFor(() => expect(f.button("Confirm directory sharing").disabled).toBe(false));
    expect(projectDirectories.prepare).toHaveBeenCalledWith(owner, "src");
    expect(projectDirectories.commit).not.toHaveBeenCalled();
    expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    f.button("Confirm directory sharing").click();
    await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false));
    expect(projectDirectories.commit).toHaveBeenCalledWith(owner, id);
    expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(f.gateway.invokeResource.mock.calls[0][1]).toMatchObject({ resourceId: id, contentVersion: "a".repeat(64) });
    f.button("Files").click();
    expect(f.gateway.revokeResource).toHaveBeenCalledWith({ schemaVersion: 1, owner: serializedOwner, resourceId: id, contentVersion: "a".repeat(64) });
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("cancels a pending directory grant without executing", async () => {
    const owner = { runtimeId: "runtime", sessionId: "session", pluginId: "receiver", capabilityId: "consume" };
    const projectDirectories = { choose: vi.fn(async () => "."), prepare: vi.fn(async () => ({ profile: "resource.local-directory.draft1", confirmed: false, entryNamesRead: false, relativePath: ".", owner, grantId: id })), commit: vi.fn(), cancel: vi.fn(async () => ({})) };
    const f = fixture({ projectDirectories }, 1, true);
    f.button("Folder").click(); f.button("Choose a folder").click();
    await vi.waitFor(() => expect(f.button("Confirm directory sharing").disabled).toBe(false));
    f.button("Cancel directory sharing").click();
    expect(projectDirectories.cancel).toHaveBeenCalledWith(owner, id);
    expect(projectDirectories.commit).not.toHaveBeenCalled();
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("identifies directory preparation failures without exposing a raw path", async () => {
    const projectDirectories = {
      choose: vi.fn(async () => "."),
      prepare: vi.fn(async () => { throw Object.assign(new Error("private path E:\\secret"), { code: "resource_directory_unavailable" }); }),
      commit: vi.fn(), cancel: vi.fn(),
    };
    const f = fixture({ projectDirectories }, 1, true);
    f.button("Folder").click(); f.button("Choose a folder").click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("resource_directory_unavailable"));
    expect(document.body.textContent).not.toContain("E:\\secret");
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("revokes a directory resource returned after the user canceled confirmation", async () => {
    const owner = { runtimeId: "runtime", sessionId: "session", pluginId: "receiver", capabilityId: "consume" };
    const access = { schemaVersion: 1, owner, resourceId: id, contentVersion: "a".repeat(64) };
    let finishCommit;
    const projectDirectories = {
      choose: vi.fn(async () => "."),
      prepare: vi.fn(async () => ({ profile: "resource.local-directory.draft1", confirmed: false, entryNamesRead: false, relativePath: ".", owner, grantId: id })),
      commit: vi.fn(() => new Promise(resolve => { finishCommit = resolve; })),
      cancel: vi.fn(async () => ({})),
    };
    const f = fixture({ projectDirectories }, 1, true);
    f.button("Folder").click(); f.button("Choose a folder").click();
    await vi.waitFor(() => expect(f.button("Confirm directory sharing").disabled).toBe(false));
    f.button("Confirm directory sharing").click();
    await vi.waitFor(() => expect(finishCommit).toBeTypeOf("function"));
    f.button("Cancel directory sharing").click();
    finishCommit({ profile: "resource.local-directory.draft1", confirmed: true, entryCount: 1, access });
    await vi.waitFor(() => expect(f.gateway.revokeResource).toHaveBeenCalledWith(access));
    expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("passes a confirmed two-file group through one-use invocation", async () => {
    const f = fixture({}, 2);
    const ids = [id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]; let next = 0;
    f.gateway.prepareResource.mockImplementation(async () => ({ resourceId: ids[next++] }));
    const makeFile = text => ({ name: `${text}.txt`, size: 3, type: "text/plain",
      arrayBuffer: async () => new TextEncoder().encode(text).buffer });
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [makeFile("one"), makeFile("two")] });
    input.dispatchEvent(new Event("change"));
    expect(f.gateway.prepareResource).not.toHaveBeenCalled();
    f.button("Confirm file sharing").click();
    await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false));
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(f.gateway.invokeResourceCall.mock.calls[0][1].additionalResources).toEqual([
      { resourceId: ids[1], contentVersion: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    expect(JSON.stringify(f.gateway.invokeResourceCall.mock.calls[0])).not.toContain("one.txt");
    expect(JSON.stringify(f.gateway.invokeResourceCall.mock.calls[0])).not.toContain("two.txt");
    f.button("Cancel file sharing").click();
    expect(f.gateway.revokeResource).toHaveBeenCalledTimes(2);
  });
  it("does not render a delayed result after its selected resource is revoked", async () => {
    const f = fixture(); await f.share();
    const original = f.gateway.invokeResource.getMockImplementation(); let finish;
    f.gateway.invokeResource.mockImplementation((...args) => new Promise(resolve => { finish = async () => resolve(await original(...args)); }));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.button("Cancel file sharing").click(); await finish();
    await vi.waitFor(() => expect(f.onBusy).toHaveBeenLastCalledWith(false));
    expect(document.querySelector(".tool-result").textContent).toBe("");
    expect(f.onSuccess).not.toHaveBeenCalled();
  });
  it("protects busy state across active and changed-Host checks without replaying", async () => {
    const f = fixture(); await f.share(); f.gateway.invokeResource.mockRejectedValue(new Error("lost response"));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(f.button("Stop and recover call").hidden).toBe(false));
    f.button("Stop and recover call").click(); await vi.waitFor(() => expect(document.body.textContent).toContain("tool is still active"));
    expect(f.button("Execute tool").disabled).toBe(true); expect(f.onBusy).toHaveBeenLastCalledWith(true);
    f.gateway.reconcileResourceCall.mockRejectedValue({ code: "resource_call_host_changed" });
    f.button("Stop and recover call").click(); await vi.waitFor(() => expect(document.body.textContent).toContain("Studio restarted"));
    expect(f.button("Execute tool").disabled).toBe(true); expect(f.gateway.invokeResource).toHaveBeenCalledOnce();
  });
  it("shows only a fixed public failure code while a call needs recovery", async () => {
    const f = fixture(); await f.share();
    f.gateway.invokeResource.mockRejectedValue({ code: "resource_ocr_failed", message: "private E:\\secret" });
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.button("Stop and recover call").hidden).toBe(false));
    expect(document.body.textContent).toContain("resource_ocr_failed");
    expect(document.body.textContent).not.toContain("E:\\secret");
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("opens without reading/running, confirms catalog-bound input, then executes separately and escapes output", async () => {
    const f = fixture(); expect(f.gateway.prepareResource).not.toHaveBeenCalled(); expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    await f.share(); expect(f.gateway.prepareResource).toHaveBeenCalledWith(expect.objectContaining({ catalogRevision: "a".repeat(64), owner: { runtimeId: "runtime", sessionId: "session", pluginId: "receiver", capabilityId: "consume" } })); expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    f.button("Execute tool").click(); await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(f.gateway.invokeResource.mock.calls[0][1].input).toEqual({ count: 0, flag: false }); expect(document.querySelector("script")).toBeNull(); expect(document.querySelector(".tool-result").textContent).toContain("<script>literal</script>");
    f.button("Cancel file sharing").click(); expect(f.gateway.revokeResource).toHaveBeenCalledOnce(); expect(document.querySelector(".tool-result").textContent).toBe("");
  });
  it("cancels a pending catalog recheck without starting a Worker", async () => {
    const f = fixture(); await f.share(); let resolve;
    f.gateway.loadTool.mockImplementation(() => new Promise(done => { resolve = done; }));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(resolve).toBeTypeOf("function")); f.button("Cancel tool").click();
    resolve({ enabled: true, revision: "a".repeat(64), version: "1" }); await vi.waitFor(() => expect(f.onBusy).toHaveBeenLastCalledWith(false));
    expect(f.gateway.invokeResource).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("cancelled");
  });
  it("cancels execution independently and keeps the run control blocked until it settles", async () => {
    const f = fixture(); await f.share(); let reject;
    f.gateway.invokeResource.mockImplementation(() => new Promise((_done, fail) => { reject = fail; }));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(reject).toBeTypeOf("function")); f.button("Cancel tool").click();
    await vi.waitFor(() => expect(f.gateway.reconcileResourceCall).toHaveBeenCalledOnce()); expect(f.button("Execute tool").disabled).toBe(true);
    reject({ code: "worker_cancelled" }); await vi.waitFor(() => expect(f.button("Stop and recover call").hidden).toBe(false));
    expect(f.button("Execute tool").disabled).toBe(true);
    f.gateway.reconcileResourceCall.mockImplementation(async (owner, call) => reconciliation(owner, call.callId, "ended"));
    f.button("Stop and recover call").click(); await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false)); expect(f.onSuccess).not.toHaveBeenCalled();
  });
  it("rejects changed catalog metadata before invoking", async () => {
    const f = fixture(); await f.share(); f.gateway.loadTool.mockRejectedValue({ code: "catalog_changed" }); f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.onBusy).toHaveBeenLastCalledWith(false)); expect(f.gateway.invokeResource).not.toHaveBeenCalled(); expect(f.onSuccess).not.toHaveBeenCalled();
  });
  it("does not execute after session changes, and disposes the granted reference", async () => {
    const f = fixture(); await f.share(); f.switchTarget(); f.button("Execute tool").click(); expect(f.gateway.invokeResource).not.toHaveBeenCalled(); f.controller.destroy(); expect(f.gateway.revokeResource).toHaveBeenCalledOnce();
  });
  it("does not record business errors as successful recent use", async () => {
    const f = fixture(); await f.share(); const original = f.gateway.invokeResource.getMockImplementation();
    f.gateway.invokeResource.mockImplementation(async (...args) => ({ ...await original(...args), result: { ok: false, error: { code: "INVALID_INPUT" } } }));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(document.querySelector(".tool-result").textContent).toContain("INVALID_INPUT"));
    expect(document.body.textContent).toContain("Tool reported an error. Inputs are kept and no result was saved.");
    expect(document.body.textContent).not.toContain("Tool finished. Review the result and save any output files explicitly.");
    expect(f.button("Execute tool").disabled).toBe(false);
    expect(f.onSuccess).not.toHaveBeenCalled();
  });
});
