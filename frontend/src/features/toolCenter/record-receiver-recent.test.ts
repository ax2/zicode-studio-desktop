import { webcrypto, createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { emptyAccess } from "../commandPalette/tool-access";
import { recordReceiverRecent } from "./record-receiver-recent";
afterEach(() => vi.unstubAllGlobals());
it("hashes the complete JSON tuple, preserves Unicode and delimiter identities, and records only its scope", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const mutate = vi.fn(async () => emptyAccess());
  const store = { read: vi.fn(async () => emptyAccess()), mutate };
  for (const [pluginId, capabilityId] of [["a/b", "c"], ["a", "b/c"], ["中文", "换行\n\"\\"]]) {
    await recordReceiverRecent({ sceneId: "programming", workspaceId: "w", pluginId, capabilityId }, store, () => true);
    expect(mutate).toHaveBeenLastCalledWith({ sceneId: "programming", workspaceId: "w" },
      { kind: "recentRecord", id: `manual.tool:${createHash("sha256").update(JSON.stringify([pluginId, capabilityId])).digest("hex")}` });
  }
});
it("does not mutate when superseded during hashing", async () => {
  let finish!: (value: ArrayBuffer) => void;
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn(() => new Promise(done => { finish = done; })) } });
  let active = true;
  const store = { read: vi.fn(async () => emptyAccess()), mutate: vi.fn(async () => emptyAccess()) };
  const pending = recordReceiverRecent({ sceneId: "s", workspaceId: "w", pluginId: "p", capabilityId: "c" }, store, () => active);
  active = false; finish(new ArrayBuffer(32)); await pending;
  expect(store.mutate).not.toHaveBeenCalled();
});
