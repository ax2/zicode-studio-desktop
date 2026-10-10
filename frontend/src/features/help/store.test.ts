import { describe, expect, it, vi } from "vitest";
import { createHelpStore } from "./store";

const pages = ["getting-started", "projects-tasks"].map((id) => ({
  id,
  title: id,
  file: `${id}.md`,
}));
const manifest = { pages };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const response = (markdown: string) => ({ ok: true, text: async () => markdown }) as Response;

describe("help request ordering", () => {
  it.each([
    false,
    true,
  ])("ignores an old page finishing after navigation, failure=%s", async (failure) => {
    const old = deferred<Response>();
    const fetchImpl = vi.fn(async (url) =>
      String(url).endsWith("getting-started.md") ? old.promise : response("# Current project"),
    );
    const store = createHelpStore({ fetchImpl: fetchImpl as typeof fetch });
    store.setState({ manifest });
    const first = store
      .getState()
      .loadPage("getting-started")
      .catch(() => {});
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await store.getState().loadPage("projects-tasks");
    if (failure) old.reject(new Error("Old failure"));
    else old.resolve(response("# Old page"));
    await first;
    expect(store.getState().activePage).toBe("projects-tasks");
    expect(store.getState().article?.markdown).toBe("# Current project");
    expect(store.getState().error).toBeNull();
  });

  it("does not restore a previous language's delayed manifest", async () => {
    let locale = "zh-CN";
    const old = deferred<Response>();
    const fetchImpl = vi.fn(async (url) => {
      if (url === "/help/manifest.json") return old.promise;
      if (String(url).endsWith("manifest.json"))
        return { ok: true, json: async () => manifest } as Response;
      return response("# English project");
    });
    const store = createHelpStore({
      fetchImpl: fetchImpl as typeof fetch,
      getLocaleImpl: () => locale,
    });
    const first = store.getState().loadPage("projects-tasks");
    locale = "en";
    store.getState().invalidateLocale();
    await vi.waitFor(() => expect(store.getState().article?.markdown).toBe("# English project"));
    old.resolve({
      ok: true,
      json: async () => ({ pages: [{ ...pages[0], title: "旧目录" }] }),
    } as Response);
    await first;
    expect(store.getState().manifestLocale).toBe("en");
    expect(store.getState().manifest).toEqual(manifest);
    expect(store.getState().article?.markdown).toBe("# English project");
    expect(fetchImpl).not.toHaveBeenCalledWith("/help/en/getting-started.md");
  });

  it("records current page failures and clears them on a successful retry", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue(response("# Recovered"));
    const store = createHelpStore({ fetchImpl });
    store.setState({ manifest });
    await expect(store.getState().loadPage("projects-tasks")).rejects.toThrow("Unavailable");
    expect(store.getState().error).toBe("Unavailable");
    expect(store.getState().article).toBeNull();
    await store.getState().loadPage("projects-tasks");
    expect(store.getState().error).toBeNull();
    expect(store.getState().article?.markdown).toBe("# Recovered");
  });
});
