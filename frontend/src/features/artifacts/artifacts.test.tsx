import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setLocale } from "../../shared/i18n.js";
import { ArtifactMain, ArtifactNav } from "./ArtifactApp";
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
    get: vi.fn(async () => ({
      artifact: {
        ...DESCRIPTOR,
        content: { metrics: { totalReturn: 0.12 } },
      },
    })),
    create: vi.fn(),
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
  void store.getState().load();
  return store;
}

afterEach(() => {
  document.body.innerHTML = "";
  setLocale("zh-CN");
});

describe("artifacts React app", () => {
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
