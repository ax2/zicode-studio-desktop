import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { SaveAttempts } from "./SaveAttempts";
import type { SaveAttempt, SaveAttemptPage } from "./saved-output-types";

const item: SaveAttempt = { receiptVersion: "b".repeat(64), integrity: "not_checked", publication: "observed",
  receipt: { schemaVersion: 1, profile: "resource.save.draft1", saveId: "11111111-1111-4111-8111-111111111111", workspaceId: "w",
    relativePath: ".zicode/outputs/11111111-1111-4111-8111-111111111111/result.txt", mimeType: "text/plain", byteLength: 5,
    contentVersion: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", preparedAt: "2026-10-11T00:00:00Z",
    source: { pluginId: "source", capabilityId: "copy", resourceId: "22222222-2222-4222-8222-222222222222", packageVersion: "1.0.0" } } };
function fixture() {
  const row = structuredClone(item);
  const page: SaveAttemptPage = { schemaVersion: 1, profile: "resource.save.recovery.draft1", workspaceId: "w",
    offset: 0, total: 1, pageSize: 40, hasMore: false, payloadsRead: false, skippedEntries: 0, items: [row] };
  const gateway = { attempts: vi.fn(async () => page), list: vi.fn(async () => ({ ...page, profile: "resource.library.draft1" as const })),
    read: vi.fn(async () => new Uint8Array([104, 101, 108, 108, 111]).buffer) };
  const target = () => ({ sceneId: "programming", workspaceId: "w" });
  return { page, row, gateway, target };
}
beforeEach(() => { setLocale("en"); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); setLocale("zh-CN"); });
describe("durable save record recovery", () => {
  it("loads metadata only on demand and verifies explicitly without a writer", async () => {
    const f = fixture(); render(<SaveAttempts gateway={f.gateway} getTarget={f.target} />);
    expect(f.gateway.attempts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Review save records")); await screen.findByText("source · copy");
    expect(f.gateway.read).not.toHaveBeenCalled(); expect(f.gateway.list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Check saved file")); await screen.findByText(/Verified saved file:/);
    expect(screen.getByText("Snapshot verified at the last check; later changes are possible.")).toBeTruthy();
    expect(f.gateway.read).toHaveBeenCalledOnce(); expect(Object.keys(f.gateway)).toEqual(["attempts", "list", "read"]);
  });
  it("reloads persistent metadata after the original component and source tool are gone", async () => {
    const f = fixture(); const first = render(<SaveAttempts gateway={f.gateway} getTarget={f.target} />);
    fireEvent.click(screen.getByText("Review save records")); await screen.findByText("source · copy"); first.unmount();
    render(<SaveAttempts gateway={f.gateway} getTarget={f.target} />);
    fireEvent.click(screen.getByText("Review save records")); await screen.findByText("source · copy");
    fireEvent.click(screen.getByText("Check saved file")); await screen.findByText(/Verified saved file:/);
    expect(f.gateway.attempts).toHaveBeenCalledTimes(2);
  });
  it("keeps unpublished records uncertain and never treats absence as a failed save", async () => {
    const f = fixture(); f.row.publication = "not_observed"; f.gateway.list.mockResolvedValue({ ...f.page, profile: "resource.library.draft1", items: [], total: 0 });
    render(<SaveAttempts gateway={f.gateway} getTarget={f.target} />);
    fireEvent.click(screen.getByText("Review save records")); await screen.findByText("Publication not observed; the save outcome is uncertain.");
    fireEvent.click(screen.getByText("Check saved file")); await screen.findByText(/save may still have completed/);
    expect(f.gateway.read).not.toHaveBeenCalled();
  });
  it("rejects edited contents and preserves the record for another read-only check", async () => {
    const f = fixture(); f.gateway.read.mockResolvedValue(new TextEncoder().encode("other").buffer);
    render(<SaveAttempts gateway={f.gateway} getTarget={f.target} />);
    fireEvent.click(screen.getByText("Review save records")); await screen.findByText("source · copy");
    fireEvent.click(screen.getByText("Check saved file")); await screen.findByText(/save may still have completed/);
    expect(screen.getByText("Check saved file")).toBeTruthy();
  });
  it("rejects forged project/path and inconsistent page counts before displaying records", async () => {
    for (const alter of [(f: ReturnType<typeof fixture>) => { f.row.receipt.relativePath = "../private"; },
      (f: ReturnType<typeof fixture>) => { f.page.workspaceId = "foreign"; },
      (f: ReturnType<typeof fixture>) => { f.page.total = 2; }]) {
      const f = fixture(); alter(f); const view = render(<SaveAttempts gateway={f.gateway} getTarget={f.target} />);
      fireEvent.click(screen.getByText("Review save records")); await screen.findByText(/Save records could not be loaded/);
      expect(screen.queryByText("source · copy")).toBeNull(); expect(f.gateway.read).not.toHaveBeenCalled(); view.unmount();
    }
  });
  it("drops a late read when the recovery panel closes", async () => {
    const f = fixture(); let resolve!: (value: ArrayBuffer) => void;
    f.gateway.read.mockImplementation(() => new Promise(done => { resolve = done; }));
    render(<SaveAttempts gateway={f.gateway} getTarget={f.target} />);
    fireEvent.click(screen.getByText("Review save records")); await screen.findByText("source · copy");
    fireEvent.click(screen.getByText("Check saved file")); await waitFor(() => expect(f.gateway.read).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByText("Review save records")); resolve(new TextEncoder().encode("hello").buffer);
    await waitFor(() => expect(screen.queryByText(/Verified saved file:/)).toBeNull());
  });
  it("clears records when periodic project permission revalidation fails", async () => {
    const f = fixture(); let poll!: () => Promise<void>;
    const interval = globalThis.setInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation((callback, delay, ...args) => {
      if (delay === 5000) { poll = callback as () => Promise<void>; return interval(() => {}, delay); }
      return interval(callback, delay, ...args);
    });
    render(<SaveAttempts gateway={f.gateway} getTarget={f.target} />);
    fireEvent.click(screen.getByText("Review save records")); await screen.findByText("source · copy");
    f.gateway.attempts.mockRejectedValue(new Error("private host error")); await act(async () => { await poll(); });
    await screen.findByText(/Save records could not be loaded/); expect(screen.queryByText("source · copy")).toBeNull();
    expect(screen.queryByText("private host error")).toBeNull();
  });
});
