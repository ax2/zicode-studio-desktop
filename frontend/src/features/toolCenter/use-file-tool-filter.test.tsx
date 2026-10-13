import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ManualToolApi } from "./manual-tools";
import { useFileToolFilter } from "./use-file-tool-filter";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const scope = { sceneId: "programming", workspaceId: "one" };
function gateway(entry: (workspace: string) => Promise<unknown>) {
  return { projectFiles: { entry } } as ManualToolApi;
}

it("keeps only basename intent and rejects path-shaped bridge values", async () => {
  const api = gateway(async () => "中文 & FILE.TXT");
  const view = renderHook(() => useFileToolFilter(api, scope));
  await act(async () => {});
  expect(view.result.current.fileName).toBe("中文 & FILE.TXT");
  view.unmount();
  const invalidApi = gateway(async () => "../private.txt");
  const invalid = renderHook(() => useFileToolFilter(invalidApi, scope));
  await act(async () => {});
  expect(invalid.result.current).toMatchObject({
    ready: true,
    failed: true,
    enabled: false,
    fileName: null,
  });
  invalid.unmount();
  const controlApi = gateway(async () => `bad${String.fromCharCode(133)}.txt`);
  const control = renderHook(() => useFileToolFilter(controlApi, scope));
  await act(async () => {});
  expect(control.result.current.failed).toBe(true);
});
it("ignores an old project's delayed file intent", async () => {
  let finish: (value: unknown) => void = () => {};
  const api = gateway(
    vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(null),
  );
  const view = renderHook(({ workspaceId }) => useFileToolFilter(api, { ...scope, workspaceId }), {
    initialProps: { workspaceId: "one" },
  });
  await act(async () => {});
  expect(view.result.current.ready).toBe(false);
  view.rerender({ workspaceId: "two" });
  await act(async () => {});
  expect(view.result.current.enabled).toBe(false);
  await act(async () => finish("old.txt"));
  expect(view.result.current.enabled).toBe(false);
  expect(view.result.current.ready).toBe(true);
});
it("bounds entry detection and ignores a late result after a manual choice", async () => {
  vi.useFakeTimers();
  let finish: (value: unknown) => void = () => {};
  const api = gateway(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = renderHook(() => useFileToolFilter(api, scope));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(view.result.current).toMatchObject({ ready: true, enabled: false, failed: true });
  act(() => view.result.current.setEnabled(true));
  act(() => view.result.current.setEnabled(false));
  await act(async () => finish("late.txt"));
  expect(view.result.current.enabled).toBe(false);
});
it("recovers from synchronous native bridge errors", async () => {
  const api = gateway(() => {
    throw Error("native unavailable");
  });
  const view = renderHook(() => useFileToolFilter(api, scope));
  await act(async () => {});
  expect(view.result.current).toMatchObject({ ready: true, enabled: false, failed: true });
});
it("rechecks the active window's file hint when the entry revision changes", async () => {
  const entry = vi.fn().mockResolvedValueOnce("first.zip").mockResolvedValueOnce("second.zip");
  const api = gateway(entry);
  const view = renderHook(({ revision }) => useFileToolFilter(api, scope, revision), {
    initialProps: { revision: 0 },
  });
  await act(async () => {});
  expect(view.result.current.fileName).toBe("first.zip");
  view.rerender({ revision: 1 });
  await act(async () => {});
  expect(view.result.current.fileName).toBe("second.zip");
  expect(entry).toHaveBeenCalledTimes(2);
});

it("enables resource discovery for a bounded Explorer selection without guessing a suffix", async () => {
  const api = gateway(async () => null);
  api.projectFiles = { ...api.projectFiles, entries: vi.fn(async () => ["one.zip", "two.txt"]) };
  const view = renderHook(() => useFileToolFilter(api, scope));
  await act(async () => {});
  expect(view.result.current).toMatchObject({ ready: true, enabled: true, failed: false,
    fileName: null, selectedFileCount: 2 });
  view.unmount();
});
