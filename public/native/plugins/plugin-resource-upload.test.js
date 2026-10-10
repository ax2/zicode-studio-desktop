import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadConfirmedResource } from "./plugin-resource-upload.js";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
function fixture(length = 65537) {
  vi.stubGlobal("crypto", webcrypto);
  const file = {
    size: length,
    type: "text/plain",
    arrayBuffer: vi.fn(async () => new Uint8Array(length).buffer),
  };
  let prepared;
  const gateway = {
    prepareResource: vi.fn(async (request) => {
      prepared = request;
      return { resourceId: id };
    }),
    appendResource: vi.fn(async (_access, offset, encoded) => ({
      uploadedBytes: offset + atob(encoded).length,
    })),
    commitResource: vi.fn(async (access) => ({
      ...access,
      confirmed: true,
      byteLength: prepared.byteLength,
    })),
    revokeResource: vi.fn(async () => ({ revoked: true })),
  };
  return { file, owner, gateway, isCurrent: () => true };
}
afterEach(() => vi.unstubAllGlobals());
describe("confirmed resource upload", () => {
  it("rejects saved snapshot digest drift before preparing a resource", async () => {
    const options = fixture(3);
    options.file.expectedContentVersion = "0".repeat(64);
    await expect(uploadConfirmedResource(options)).rejects.toThrow("saved_output_changed");
    expect(options.gateway.prepareResource).not.toHaveBeenCalled();
  });
  it("uploads sequential 64KiB chunks and delivers only a portable read reference", async () => {
    const options = fixture();
    const result = await uploadConfirmedResource(options);
    expect(options.gateway.appendResource.mock.calls.map((call) => call[1])).toEqual([0, 65536]);
    expect(result.reference).toEqual({
      capabilityId: "c",
      resourceId: id,
      contentVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(options.gateway.prepareResource).toHaveBeenCalledWith(
      expect.objectContaining({ owner, byteLength: 65537 }),
    );
    expect(options.gateway.revokeResource).not.toHaveBeenCalled();
  });
  it("rejects oversized files before reading or allocating", async () => {
    const options = fixture(33554433);
    await expect(uploadConfirmedResource(options)).rejects.toThrow("resource_size_invalid");
    expect(options.file.arrayBuffer).not.toHaveBeenCalled();
  });
  it("accepts an empty file without sending empty chunks", async () => {
    const options = fixture(0);
    await uploadConfirmedResource(options);
    expect(options.gateway.appendResource).not.toHaveBeenCalled();
  });
  it("revokes a draft when canceled while prepare is in flight", async () => {
    const options = fixture(3);
    let current = true;
    options.isCurrent = () => current;
    options.gateway.prepareResource.mockImplementation(async () => {
      current = false;
      return { resourceId: id };
    });
    await expect(uploadConfirmedResource(options)).rejects.toThrow("resource_selection_changed");
    expect(options.gateway.revokeResource).toHaveBeenCalledTimes(1);
    expect(options.gateway.commitResource).not.toHaveBeenCalled();
  });
  it("revokes after a commit race instead of delivering to a changed view", async () => {
    const options = fixture(3);
    let current = true;
    options.isCurrent = () => current;
    options.gateway.commitResource.mockImplementation(async () => {
      current = false;
      return {};
    });
    await expect(uploadConfirmedResource(options)).rejects.toThrow("resource_selection_changed");
    expect(options.gateway.revokeResource).toHaveBeenCalledTimes(1);
  });
  it("rejects corrupt append acknowledgments and attempts cleanup", async () => {
    const options = fixture(3);
    options.gateway.appendResource.mockResolvedValue({ uploadedBytes: 99 });
    await expect(uploadConfirmedResource(options)).rejects.toThrow("resource_append_invalid");
    expect(options.gateway.revokeResource).toHaveBeenCalledTimes(1);
  });
  it("bounds active uploads across views and releases the slot after failure", async () => {
    const options = fixture(3);
    let release;
    options.file.arrayBuffer.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = uploadConfirmedResource(options);
    const next = fixture(3);
    await expect(uploadConfirmedResource(next)).rejects.toThrow("resource_upload_busy");
    expect(next.file.arrayBuffer).not.toHaveBeenCalled();
    release(new Uint8Array(3).buffer);
    await first;
    await uploadConfirmedResource(next);
  });
});
