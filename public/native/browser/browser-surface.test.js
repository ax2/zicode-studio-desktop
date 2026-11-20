import { expect, it, vi } from "vitest";
import { createBrowserSurface } from "./browser-surface.js";
it("waits for earlier native updates before delivering later revisions, even after failure", async () => {
  let reject;
  const control = vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue({});
  const surface = createBrowserSurface(control); surface.seed(7);
  const first = surface.send({ kind: "present", tab: "old" });
  const failed = expect(first).rejects.toThrow("native failed");
  const hidden = surface.send({ kind: "hide" });
  const shown = surface.send({ kind: "present", tab: "new" });
  await vi.waitFor(() => expect(control).toHaveBeenCalledTimes(1));
  expect(control.mock.calls[0][0]).toEqual({ kind: "present", tab: "old", revision: 8 });
  reject(Error("native failed"));await failed;await hidden;await shown;
  expect(control.mock.calls.map(c => c[0])).toEqual([
    { kind: "present", tab: "old", revision: 8 }, { kind: "hide", revision: 9 }, { kind: "present", tab: "new", revision: 10 },
  ]);
});
