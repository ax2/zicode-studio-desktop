import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { ArtifactMain, ArtifactNav, createArtifactApp } from "./ArtifactApp";
import { formatBytes } from "./logic";
import { createArtifactStore } from "./store";

const DESCRIPTOR = {
  id: "artifact-1",
  handle: "artifact:artifact-1",
  sceneId: "finance",
  pluginId: "com.zicode.finance",
  kind: "report",
  title: "Deterministic backtest",
  summary: "Local engine result",
  createdAt: "2026-07-31T08:00:00Z",
  mimeType: "application/json",
  size: 128,
  version: "sha256:version",
  provenance: { engine: "finance.backtest.local", seed: 7 },
};

function createGateway() {
  return {
    list: vi.fn(async () => ({
      snapshot: {
        artifacts: [DESCRIPTOR],
        kinds: ["report"],
        plugins: ["com.zicode.finance"],
      },
    })),
    get: vi.fn(async (_scene: string, _workspace: string, _id: string) => ({
      artifact: {
        ...DESCRIPTOR,
        content: { metrics: { totalReturn: 0.12 } },
      },
    })),
    create: vi.fn(),
    importAll: vi.fn(async () => ({ imported: 1 })),
    delete: vi.fn(async () => ({ deleted: true })),
  };
}

function renderStore(gateway: ReturnType<typeof createGateway>, options: Record<string, unknown> = {}) {
  const store = createArtifactStore({
    gateway,
    getTarget: () => ({ sceneId: "finance", workspaceId: "ws-finance" }),
    ...options,
  });
  render(
    <div>
      <ArtifactNav store={store} />
      <ArtifactMain store={store} />
    </div>,
  );
  return store;
}

afterEach(() => {
  document.body.innerHTML = "";
  setLocale("zh-CN");
});

describe("artifacts React app", () => {
  it.each([[true, true], [true, false], [false, true], [false, false]])("keeps deep-link selection: list starts first=%s, finishes first=%s", async (listStartsFirst, listFirst) => {
    const gateway = createGateway();
    let finishList!: (value: Awaited<ReturnType<typeof gateway.list>>) => void;
    let finishDetail!: (value: Awaited<ReturnType<typeof gateway.get>>) => void;
    gateway.list.mockImplementation(() => new Promise(resolve => { finishList = resolve; }));
    gateway.get.mockImplementation(() => new Promise(resolve => { finishDetail = resolve; }));
    const store = createArtifactStore({ gateway });
    const first = listStartsFirst ? store.getState().load() : store.getState().openArtifact(DESCRIPTOR.id);
    const second = listStartsFirst ? store.getState().openArtifact(DESCRIPTOR.id) : store.getState().load();
    const loading = listStartsFirst ? first : second, opening = listStartsFirst ? second : first;
    const document = { ...DESCRIPTOR, content: { metrics: { totalReturn: 0.12 } } };
    if (listFirst) {
      finishList({ snapshot: { artifacts: [], kinds: [], plugins: [] } }); await loading;
      expect(store.getState().loading).toBe(true);
      finishDetail({ artifact: document }); await opening;
    } else {
      finishDetail({ artifact: document }); await opening;
      expect(store.getState().loading).toBe(true);
      finishList({ snapshot: { artifacts: [], kinds: [], plugins: [] } }); await loading;
    }
    expect(store.getState().selected?.id).toBe(DESCRIPTOR.id);
    expect(store.getState().loading).toBe(false);
  });

  it("invalidates pending list and detail when the workspace changes", async () => {
    const gateway = createGateway();
    let finishList!: (value: Awaited<ReturnType<typeof gateway.list>>) => void;
    let finishDetail!: (value: Awaited<ReturnType<typeof gateway.get>>) => void;
    gateway.list.mockImplementation(() => new Promise(resolve => { finishList = resolve; }));
    gateway.get.mockImplementation(() => new Promise(resolve => { finishDetail = resolve; }));
    const store = createArtifactStore({ gateway });
    const opening = store.getState().openArtifact(DESCRIPTOR.id), loading = store.getState().load();
    store.getState().setTarget();
    finishList({ snapshot: { artifacts: [DESCRIPTOR], kinds: [], plugins: [] } });
    finishDetail({ artifact: { ...DESCRIPTOR, content: { metrics: { totalReturn: 0.12 } } } });
    await Promise.all([opening, loading]);
    expect(store.getState().selected).toBeNull();
    expect(store.getState().snapshot.artifacts).toEqual([]);
    expect(store.getState().loading).toBe(false);
  });
  it("does not remount over another active app when the target changes", () => {
    const app = createArtifactApp({gateway: createGateway()});
    const container = document.createElement("div"); document.body.append(container);
    app.renderContent(container);
    const other = document.createElement("div"); other.textContent = "Other active tool";
    container.replaceChildren(other); app.setTarget();
    expect(container.textContent).toBe("Other active tool"); expect(other.isConnected).toBe(true);
    app.destroy();
  });
  it("loads the artifact list automatically on mount", async () => {
    const gateway = createGateway();
    const store = createArtifactStore({
      gateway,
      getTarget: () => ({ sceneId: "finance", workspaceId: "ws-finance" }),
    });
    render(<ArtifactNav store={store} />);
    await waitFor(() => expect(gateway.list).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText("Deterministic backtest")).toBeTruthy(),
    );
  });

  it("formats byte sizes including numeric strings from the backend", () => {
    expect(formatBytes(128)).toBe("128 B");
    expect(formatBytes("2048")).toBe("2.0 KiB");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("");
    expect(formatBytes("")).toBe("");
  });

  it("lists scene artifacts and renders content with provenance in the main view", async () => {
    setLocale("en");
    const gateway = createGateway();
    const store = renderStore(gateway);
    await waitFor(() => expect(screen.getByText("Deterministic backtest")).toBeTruthy());
    fireEvent.click(screen.getByText("Deterministic backtest"));
    await waitFor(() =>
      expect(document.querySelector(".artifacts-document h1")?.textContent).toBe(
        "Deterministic backtest",
      ),
    );
    expect(gateway.get).toHaveBeenCalledWith("finance", "ws-finance", "artifact-1");
    expect(document.querySelector(".artifacts-content")?.textContent).toContain("totalReturn");
    expect(document.querySelector(".artifacts-provenance")?.textContent).toContain(
      "finance.backtest.local",
    );
    expect(document.querySelector(".artifacts-metadata")?.textContent).toContain(
      "artifact:artifact-1",
    );
    store.getState().destroy();
  });

  it("exports a readable document and deletes with its optimistic version", async () => {
    setLocale("en");
    const gateway = createGateway();
    const downloadFile = vi.fn();
    const notify = vi.fn();
    const store = renderStore(gateway, { downloadFile, notify, confirmDelete: () => true });
    await waitFor(() => expect(screen.getByText("Deterministic backtest")).toBeTruthy());
    fireEvent.click(screen.getByText("Deterministic backtest"));
    await waitFor(() => expect(document.querySelector(".artifacts-document")).toBeTruthy());

    fireEvent.click(screen.getByText("Export"));
    expect(downloadFile).toHaveBeenCalledOnce();
    expect(downloadFile.mock.calls[0][0]).toBe("Deterministic backtest.zicode-artifact.json");
    expect(downloadFile.mock.calls[0][1]).toContain('"schemaVersion": 1');

    fireEvent.click(screen.getByText("Delete"));
    await waitFor(() => expect(gateway.delete).toHaveBeenCalledOnce());
    expect(gateway.delete).toHaveBeenCalledWith(
      "finance",
      "ws-finance",
      expect.objectContaining({ id: "artifact-1", version: "sha256:version" }),
    );
    store.getState().destroy();
  });

  it("awaits an async confirmation before deleting an artifact", async () => {
    setLocale("en");
    const gateway = createGateway();
    const store = renderStore(gateway, { confirmDelete: async () => false });
    await waitFor(() => expect(screen.getByText("Deterministic backtest")).toBeTruthy());
    fireEvent.click(screen.getByText("Deterministic backtest"));
    await waitFor(() => expect(document.querySelector(".artifacts-document")).toBeTruthy());

    fireEvent.click(screen.getByText("Delete"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(gateway.delete).not.toHaveBeenCalled();
    store.getState().destroy();
  });

  it("opens an artifact by id through the deep-link handle", async () => {
    setLocale("en");
    const gateway = createGateway();
    const store = renderStore(gateway);
    await store.getState().openArtifact("artifact-1");
    expect(store.getState().selected?.id).toBe("artifact-1");
    store.getState().destroy();
  });

  it("scopes search and type filters to the active scene", async () => {
    setLocale("en");
    const gateway = createGateway();
    const store = renderStore(gateway);
    await waitFor(() => expect(screen.getByText("Deterministic backtest")).toBeTruthy());

    const search = document.querySelector(".artifacts-search") as HTMLInputElement;
    const searchField = document.querySelector(".artifacts-search-field");
    expect(searchField?.textContent).toContain("Search artifacts");
    fireEvent.change(search, { target: { value: "backtest" } });
    await waitFor(() => expect(gateway.list).toHaveBeenCalledTimes(2));
    expect(gateway.list.mock.calls[1]).toEqual([
      "finance",
      "ws-finance",
      { query: "backtest", kind: "", pluginId: "" },
    ]);
    store.getState().destroy();
  });
});

describe("artifact store host errors", () => {
  it("localizes a closed Pi runtime in the error state", async () => {
    setLocale("zh-CN");
    const gateway = createGateway();
    gateway.list.mockRejectedValueOnce(new Error("Pi RPC request failed: ProcessClosed"));
    const store = createArtifactStore({
      gateway,
      getTarget: () => ({ sceneId: "finance", workspaceId: "ws-finance" }),
    });
    await store.getState().load();
    expect(store.getState().error?.message).toBe(
      "Pi 运行时连接已断开。请重试或新建一个会话。",
    );
    store.getState().destroy();
  });
});

describe("artifact bulk export", () => {
  it("bundles every artifact into one download", async () => {
    setLocale("en");
    const downloadFile = vi.fn();
    const gateway = createGateway();
    gateway.list.mockResolvedValue({
      snapshot: {
        artifacts: [
          DESCRIPTOR,
          { ...DESCRIPTOR, id: "artifact-2", title: "Second" },
        ],
        kinds: ["report"],
        plugins: ["com.zicode.finance"],
      },
    });
    gateway.get.mockImplementation(
      async (_scene: string, _workspace: string, id: string) => ({
      artifact: {
        ...DESCRIPTOR,
        id,
        title: id === "artifact-2" ? "Second" : DESCRIPTOR.title,
        content: { metrics: { totalReturn: 0.12 } },
      },
      }),
    );
    const store = createArtifactStore({
      gateway,
      getTarget: () => ({ sceneId: "finance", workspaceId: "ws-finance" }),
      notify: vi.fn(),
      downloadFile,
    });
    await store.getState().load();
    await store.getState().exportAll();

    expect(gateway.get).toHaveBeenCalledTimes(2);
    expect(downloadFile).toHaveBeenCalledOnce();
    const [fileName, content] = downloadFile.mock.calls[0];
    expect(fileName).toBe("zicode-artifacts-all-ws-finan.json");
    const bundle = JSON.parse(content);
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.artifacts).toHaveLength(2);
    expect(bundle.artifacts[1].title).toBe("Second");
    store.getState().destroy();
  });

  it("notifies when there is nothing to export", async () => {
    setLocale("en");
    const notify = vi.fn();
    const gateway = createGateway();
    gateway.list.mockResolvedValue({
      snapshot: { artifacts: [], kinds: [], plugins: [] },
    });
    const store = createArtifactStore({
      gateway,
      getTarget: () => ({ sceneId: "finance", workspaceId: "ws-finance" }),
      notify,
      downloadFile: vi.fn(),
    });
    await store.getState().load();
    await store.getState().exportAll();
    expect(notify).toHaveBeenCalledWith("No artifacts to export");
    store.getState().destroy();
  });
});

describe("artifact bulk import", () => {
  it("restores a bundle through the gateway and reloads the list", async () => {
    setLocale("en");
    const importAll = vi.fn(async () => ({ imported: 1 }));
    const notify = vi.fn();
    const gateway = createGateway();
    gateway.importAll.mockImplementation(importAll);
    const store = createArtifactStore({
      gateway,
      getTarget: () => ({ sceneId: "finance", workspaceId: "ws-finance" }),
      notify,
      downloadFile: vi.fn(),
      chooseFile: vi.fn(
        async () =>
          ({
            size: 256,
            text: async () =>
              JSON.stringify({
                schemaVersion: 1,
                artifacts: [
                  {
                    id: "artifact-1",
                    title: "Backtest",
                    content: { metrics: {} },
                  },
                ],
              }),
          }) as unknown as File,
      ),
    });
    await store.getState().importAll();
    expect(importAll).toHaveBeenCalledWith(
      "finance",
      "ws-finance",
      expect.any(Array),
    );
    expect(notify).toHaveBeenCalledWith("All artifacts imported");
    store.getState().destroy();
  });

  it("rejects a non-object artifact bundle", async () => {
    setLocale("en");
    const importAll = vi.fn(async () => ({ imported: 1 }));
    const notify = vi.fn();
    const gateway = createGateway();
    gateway.importAll.mockImplementation(importAll);
    const store = createArtifactStore({
      gateway,
      getTarget: () => ({ sceneId: "finance", workspaceId: "ws-finance" }),
      notify,
      downloadFile: vi.fn(),
      chooseFile: vi.fn(
        async () => ({ size: 16, text: async () => '"hello"' }) as unknown as File,
      ),
    });
    await store.getState().importAll();
    expect(importAll).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("Artifact bundle is not valid JSON");
    store.getState().destroy();
  });

  it("sends the selected artifact into the chat composer", async () => {
    setLocale("en");
    const gateway = createGateway();
    const onUseInChat = vi.fn();
    const store = renderStore(gateway, { onUseInChat });
    await waitFor(() =>
      expect(screen.getByText("Deterministic backtest")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Deterministic backtest"));
    await waitFor(() => expect(screen.getByText("Add to chat")).toBeTruthy());
    fireEvent.click(screen.getByText("Add to chat"));
    await waitFor(() => expect(onUseInChat).toHaveBeenCalled());
    const prompt = String(onUseInChat.mock.calls[0][0]);
    expect(prompt).toContain("Discuss the artifact");
    expect(prompt).toContain("Deterministic backtest");
    expect(prompt).toContain("totalReturn");
    store.getState().destroy();
  });

  it("offers a copy-content action on the artifact detail", async () => {
    setLocale("en");
    const gateway = createGateway();
    const store = renderStore(gateway);
    await waitFor(() =>
      expect(screen.getByText("Deterministic backtest")).toBeTruthy(),
    );
    fireEvent.click(screen.getByText("Deterministic backtest"));
    await waitFor(() => expect(screen.getByText("Copy content")).toBeTruthy());
    const schedule = vi.spyOn(globalThis, "setTimeout");
    fireEvent.click(screen.getByText("Copy content"));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    const copyTimerIndex = schedule.mock.calls.findIndex((args) => args[1] === 1600);
    expect(copyTimerIndex).toBeGreaterThanOrEqual(0);
    const cancel = vi.spyOn(globalThis, "clearTimeout");
    cleanup();
    expect(cancel).toHaveBeenCalledWith(schedule.mock.results[copyTimerIndex].value);
    cancel.mockRestore();
    schedule.mockRestore();
    store.getState().destroy();
  });
});
