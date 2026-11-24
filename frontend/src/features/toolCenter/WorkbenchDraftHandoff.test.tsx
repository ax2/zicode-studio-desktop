import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolDirectory } from "./ManualToolDirectory";
import { workbenchDraftFile } from "./workbench-draft-file";
import type { ManualTool, ManualToolApi } from "./manual-tools";

const pluginId = "com.zicode.devtools.compute";
const prefix = "devtools.compute.table.";
const scope = { sceneId: "programming", workspaceId: "workbench-owner" };
const revision = "workbench-catalog";
const tools: ManualTool[] = ["query", "json", "csv"].map((mode) => ({
  toolId: mode,
  accessId: mode,
  pluginId,
  capabilityId: prefix + mode,
  title: "Fixture " + mode,
  applicationName: "Compute",
  publisher: "ZiCode",
  version: "0.2.0",
  enabled: true,
  runtime: "wasi",
}));
const shape = {
  type: "object",
  properties: {
    text: { type: "string", maxLength: 8192 },
    options: { type: "string", maxLength: 16384 },
  },
  required: ["text"],
  additionalProperties: false,
};
const result = (format: string, text: string) => ({
  result: {
    contractVersion: "1.0.0-rc.1",
    ok: true,
    error: null,
    data: {
      text: JSON.stringify({
        format,
        text,
        columns: ["city", "id"],
        inputRows: 2,
        selectedRows: 1,
      }),
    },
  },
});
const instance = '{"headers":["city","id"],"rows":[["keep",18446744073709551615],["skip",1]]}';

function setup(
  invoke: ManualToolApi["invoke"] = async () =>
    result("json", '[{"city":"keep","id":18446744073709551615}]'),
  schemas?: Map<string, unknown>,
) {
  const api = {
    searchTools: vi.fn<ManualToolApi["searchTools"]>(async (_scene, { query }) => {
      const items = query ? tools.filter((tool) => tool.capabilityId === query) : tools;
      return { items, revision, total: items.length, nextOffset: null };
    }),
    loadTool: vi.fn<ManualToolApi["loadTool"]>(async (_scene, selected) => ({
      pluginId,
      version: "0.2.0",
      revision: selected.revision,
      enabled: true,
      capability: {
        id: selected.capabilityId,
        inputSchema: schemas?.get(selected.capabilityId) ?? shape,
      },
      permissions: [],
    })),
    invoke: vi.fn(invoke),
  };
  let currentGateway: ManualToolApi = api;
  let currentWorkspace = scope.workspaceId;
  let catalogRevision = 1;
  const directory = (request?: ManualTool) => (
    <ManualToolDirectory
      api={currentGateway}
      scope={{ ...scope, workspaceId: currentWorkspace }}
      catalogRevision={catalogRevision}
      requestedTool={request ? { tool: request, revision } : undefined}
      openApplication={() => undefined}
    />
  );
  const view = render(directory());
  const switchWorkspace = (workspaceId: string) => {
    currentWorkspace = workspaceId;
    view.rerender(directory());
  };
  const switchApi = () => {
    currentGateway = { ...api };
    view.rerender(directory());
  };
  const switchCatalog = () => {
    catalogRevision++;
    view.rerender(directory());
  };
  const requestTool = (mode: string) =>
    view.rerender(directory(tools.find((tool) => tool.toolId === mode)));
  return { api, switchWorkspace, switchApi, switchCatalog, requestTool };
}

const dialogDescriptors = {
  showModal: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal"),
  close: Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close"),
};
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterAll(() => {
  for (const key of ["showModal", "close"] as const) {
    const descriptor = dialogDescriptors[key];
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});
beforeEach(() => setLocale("en"));
afterEach(cleanup);

const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
};
const editor = (key: "text" | "options") =>
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: key === "text" ? /Input text/ : "options",
  });
async function open(mode: string) {
  const title = await screen.findByRole("heading", { name: "Fixture " + mode });
  const card = title.closest("article");
  if (!card) throw Error("Missing tool card");
  const button = within(card).getByRole<HTMLButtonElement>("button", { name: "Open tool" });
  await waitFor(() => expect(button.disabled).toBe(false));
  await act(async () => {
    fireEvent.click(button);
  });
  await screen.findByRole("form", { name: "Tool inputs" });
}
async function runQuery() {
  await open("query");
  fireEvent.change(editor("text"), { target: { value: instance } });
  fireEvent.change(editor("options"), {
    target: { value: '{"format":"json","query":"keep","sort":"city"}' },
  });
  await click("Execute tool");
}
async function chooseDraft(target: "json" | "csv") {
  await click("Send result as table draft…");
  const receiver = screen.getByRole("combobox", { name: "Receiving tool" });
  fireEvent.change(receiver, { target: { value: target } });
}

it("leaves the source and any already open receiving draft intact", async () => {
  const { api } = setup();
  await open("json");
  fireEvent.change(editor("text"), { target: { value: "existing receiver draft" } });
  await click("Tool directory");
  await runQuery();
  await chooseDraft("json");
  await click("Cancel");
  expect(editor("text").value).toBe(instance);
  expect(api.invoke).toHaveBeenCalledTimes(1);
  await chooseDraft("json");
  await click("Open receiving draft");
  expect((await screen.findByRole("alert")).textContent).toContain("already has an open tab");
  expect(editor("text").value).toBe(instance);
  await click("Fixture json");
  expect(editor("text").value).toBe("existing receiver draft");
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("refuses a receiving catalog that no longer accepts the format field", async () => {
  const schemas = new Map<string, unknown>([
    [
      prefix + "json",
      {
        type: "object",
        properties: { text: { type: "string", maxLength: 8192 } },
        required: ["text"],
      },
    ],
  ]);
  const { api } = setup(undefined, schemas);
  await runQuery();
  await chooseDraft("json");
  await click("Open receiving draft");
  expect((await screen.findByRole("alert")).textContent).toContain("Could not open");
  expect(editor("text").value).toBe(instance);
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("drops a pending confirmation when the workspace changes and returns", async () => {
  const { api, switchWorkspace } = setup();
  await runQuery();
  const previousLoad = api.loadTool.getMockImplementation();
  const receival = { complete: () => {} };
  api.loadTool.mockImplementationOnce(async (...args) => {
    await new Promise<void>((resolve) => {
      receival.complete = resolve;
    });
    if (!previousLoad) throw Error("Expected metadata fixture");
    return previousLoad(...args);
  });
  await chooseDraft("csv");
  const confirm = screen.getByRole("button", { name: "Open receiving draft" });
  await act(async () => {
    confirm.click();
    confirm.click();
  });
  await waitFor(() => expect(api.loadTool).toHaveBeenCalledTimes(2));
  switchWorkspace("another-workspace");
  switchWorkspace(scope.workspaceId);
  await act(async () => receival.complete());
  expect(screen.queryByRole("button", { name: "Fixture csv" })).toBeNull();
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("clears only a seeded tool when the gateway changes within the same workspace", async () => {
  const { api, switchApi } = setup();
  await runQuery();
  await chooseDraft("csv");
  await click("Open receiving draft");
  await screen.findByRole("button", { name: "Fixture csv" });
  expect(editor("text").value).toContain("18446744073709551615");
  switchApi();
  await screen.findByRole("form", { name: "Tool inputs" });
  expect(editor("text").value).toBe("");
  expect(editor("options").value).toBe("");
  await click("Fixture query");
  expect(editor("text").value).toBe(instance);
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

const candidate = process.env.ZICODE_TEST_COMPUTE_PACKAGE;
const worker = process.env.ZICODE_TEST_TRANSFORM_WORKER;
it.runIf(Boolean(candidate && worker))(
  "opens and manually runs a receiver from a real frozen Windows Worker result",
  async () => {
    if (!candidate || !worker) throw Error("Worker fixture unavailable");
    const manifest = JSON.parse(readFileSync(join(candidate, "plugin.json"), "utf8"));
    const schemas = new Map<string, unknown>(
      manifest.contributes.capabilities.map((capability: { id: string; inputSchema: unknown }) => [
        capability.id,
        capability.inputSchema,
      ]),
    );
    const { api, switchWorkspace } = setup(
      async (sceneId, _workspace, pluginId, capabilityId, input) => {
        const process = spawnSync(worker, ["--zicode-plugin-worker"], {
          input: JSON.stringify({
            workerPath: join(candidate, manifest.runtime.wasi),
            workerKind: "wasi",
            pluginId,
            capabilityId,
            sceneId,
            input,
          }),
          windowsHide: true,
          encoding: "utf8",
          timeout: 12000,
        });
        expect(process.status, process.stderr).toBe(0);
        return JSON.parse(process.stdout);
      },
      schemas,
    );
    await runQuery();
    await chooseDraft("csv");
    expect(api.invoke).toHaveBeenCalledTimes(1);
    await click("Open receiving draft");
    await screen.findByRole("button", { name: "Fixture csv" });
    const draft = '{"headers":["city","id"],"rows":[["keep",18446744073709551615]]}';
    expect(editor("text").value).toBe(draft);
    expect(editor("options").value).toBe('{"format":"json"}');
    expect(api.invoke).toHaveBeenCalledTimes(1);
    await click("Execute tool");
    expect(api.invoke.mock.calls[1].slice(0, 5)).toEqual([
      scope.sceneId,
      scope.workspaceId,
      pluginId,
      prefix + "csv",
      {
        text: draft,
        options: '{"format":"json"}',
      },
    ]);
    const wire = JSON.parse(
      within(
        screen.getByRole("region", { name: "Latest execution" }),
      ).getByLabelText<HTMLTextAreaElement>("Original response").value,
    );
    expect(JSON.parse(wire.data.text).text).toBe("city,id\nkeep,18446744073709551615\n");
    await click("Fixture query");
    expect(editor("text").value).toBe(instance);
    await closeWorkbench("query", "Keep draft and close");
    await click("Tool directory");
    await open("query");
    expect(editor("text").value).toBe(instance);
    expect(editor("options").value).toBe('{"format":"json","query":"keep","sort":"city"}');
    expect(api.invoke).toHaveBeenCalledTimes(2);
    await click("Execute tool");
    expect(api.invoke.mock.calls[2][4]).toEqual({
      text: instance,
      options: editor("options").value,
    });
    await click("Fixture csv");
    switchWorkspace("another-workspace");
    await screen.findByRole("form", { name: "Tool inputs" });
    expect(editor("text").value).toBe("");
    switchWorkspace(scope.workspaceId);
    await screen.findByRole("form", { name: "Tool inputs" });
    expect(editor("text").value).toBe("");
  },
  20_000,
);

async function closeWorkbench(
  mode: string,
  action: "Keep draft and close" | "Discard and close" | "Close tool" | "Cancel",
) {
  await click("Close tool: Fixture " + mode);
  const dialog = await screen.findByRole("dialog");
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: action }));
  });
}

it("keeps only explicitly retained inputs, resumes editing, and clears on discard", async () => {
  const { api, requestTool } = setup();
  await runQuery();
  const options = editor("options").value;
  const storage = vi.spyOn(Storage.prototype, "setItem");
  try {
    await closeWorkbench("query", "Cancel");
    expect(editor("text").value).toBe(instance);
    expect(screen.getByRole("region", { name: "Latest execution" })).toBeTruthy();
    await closeWorkbench("query", "Keep draft and close");
    expect(screen.queryByRole("form", { name: "Tool inputs" })).toBeNull();
    requestTool("query");
    await screen.findByRole("form", { name: "Tool inputs" });
    expect(editor("text").value).toBe(instance);
    expect(editor("options").value).toBe(options);
    expect(screen.queryByRole("region", { name: "Latest execution" })).toBeNull();
    expect(api.invoke).toHaveBeenCalledTimes(1);
    await closeWorkbench("query", "Discard and close");
    await open("query");
    expect(editor("text").value).toBe("");
    expect(editor("options").value).toBe("");
    expect(storage).not.toHaveBeenCalled();
  } finally {
    storage.mockRestore();
  }
});

it.each([
  "workspace",
  "connection",
  "catalog",
] as const)("discards closed drafts when the %s changes", async (boundary) => {
  const { api, switchWorkspace, switchApi, switchCatalog } = setup();
  await open("query");
  fireEvent.change(editor("text"), { target: { value: "fixture-private-draft" } });
  await closeWorkbench("query", "Keep draft and close");
  if (boundary === "workspace") {
    switchWorkspace("other");
    switchWorkspace(scope.workspaceId);
  } else if (boundary === "connection") switchApi();
  else switchCatalog();
  await open("query");
  expect(editor("text").value).toBe("");
  expect(api.invoke).not.toHaveBeenCalled();
});

it("keeps a closed receiver draft when a result handoff selects the same tool", async () => {
  const { api } = setup();
  await open("json");
  fireEvent.change(editor("text"), { target: { value: "kept receiver contents" } });
  await closeWorkbench("json", "Keep draft and close");
  await runQuery();
  await chooseDraft("json");
  await click("Open receiving draft");
  expect((await screen.findByRole("alert")).textContent).toContain("has a kept draft");
  await click("Cancel");
  await click("Tool directory");
  await open("json");
  expect(editor("text").value).toBe("kept receiver contents");
  expect(api.invoke).toHaveBeenCalledTimes(1);
});

it("does not retain a draft over the workbench UTF-8 limit", async () => {
  const { api } = setup();
  await open("query");
  fireEvent.change(editor("text"), { target: { value: "中".repeat(2731) } });
  await click("Close tool: Fixture query");
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByRole("button", { name: "Keep draft and close" })).toBeNull();
  expect(api.invoke).not.toHaveBeenCalled();
});

it("uses the current tool details when a previous gateway's response arrives late", async () => {
  const { api, switchApi } = setup();
  const original = api.loadTool.getMockImplementation();
  if (!original) throw Error("Expected metadata fixture");
  const delivery = { resolve: () => {} };
  api.loadTool.mockImplementationOnce(async (...args) => {
    await new Promise<void>((resolve) => {
      delivery.resolve = resolve;
    });
    return { ...(await original(...args)), revision: "outdated", enabled: false };
  });
  const opening = open("query");
  await waitFor(() => expect(api.loadTool).toHaveBeenCalledTimes(1));
  switchApi();
  await opening;
  fireEvent.change(editor("text"), { target: { value: instance } });
  await act(async () => delivery.resolve());
  await closeWorkbench("query", "Keep draft and close");
  await open("query");
  expect(editor("text").value).toBe(instance);
  expect(api.invoke).not.toHaveBeenCalled();
});

function draftSelection(contents: string, name = "previous-draft.json") {
  const bytes = new TextEncoder().encode(contents);
  const file = {
    name, size: bytes.length,
    slice: () => ({ arrayBuffer: async () => bytes.buffer }),
  };
  const picker = screen.getByLabelText("Workbench draft file");
  fireEvent.change(picker, { target: { files: [file] } });
}

it("reviews a selected draft, restores all inputs and supports undo without writing or running", async () => {
  const { api, requestTool } = setup();
  requestTool("query");
  await screen.findByRole("form", { name: "Tool inputs" });
  fireEvent.change(editor("text"), { target: { value: "previous editor value" } });
  fireEvent.change(editor("options"), { target: { value: '{"format":"csv"}' } });
  const options = ' { "format": "json", "query": "keep", "output":"tsv", "sort":"id", "descending":true } ';
  const draft = workbenchDraftFile(tools[0], { text: instance, options })!;
  draftSelection(draft);
  let confirmation = await screen.findByRole("group", { name: "Review workbench draft" });
  expect(confirmation.textContent).toContain("previous-draft.json");
  expect(editor("text").value).toBe("previous editor value");
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  expect(editor("text").value).toBe("previous editor value");
  draftSelection(draft);
  confirmation = await screen.findByRole("group", { name: "Review workbench draft" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Replace current draft" }));
  await waitFor(() => expect(editor("text").value).toBe(instance));
  expect(editor("options").value).toBe(options);
  expect(api.invoke).not.toHaveBeenCalled();
  expect(api.loadTool).toHaveBeenCalledTimes(2);
  await click("Undo last import");
  expect(editor("text").value).toBe("previous editor value");
  expect(editor("options").value).toBe('{"format":"csv"}');
});

it("will not restore an old selection after edits, a tab switch or a changed live version", async () => {
  const { api, requestTool } = setup();
  requestTool("query");
  await screen.findByRole("form", { name: "Tool inputs" });
  const draft = workbenchDraftFile(tools[0], { text: instance })!;
  draftSelection(draft);
  await screen.findByRole("group", { name: "Review workbench draft" });
  fireEvent.change(editor("text"), { target: { value: "edits after selection" } });
  expect(screen.queryByRole("group", { name: "Review workbench draft" })).toBeNull();

  draftSelection(draft);
  await screen.findByRole("group", { name: "Review workbench draft" });
  requestTool("json");
  await screen.findByRole("form", { name: "Tool inputs" });
  draftSelection(draft);
  expect((await screen.findByRole("alert")).textContent).toContain("belongs to a different tool");
  requestTool("query");
  await waitFor(() => expect(editor("text").value).toBe("edits after selection"));
  expect(screen.queryByRole("group", { name: "Review workbench draft" })).toBeNull();

  draftSelection(draft);
  const confirmation = await screen.findByRole("group", { name: "Review workbench draft" });
  const base = await api.loadTool(scope.sceneId, { pluginId, capabilityId: tools[0].capabilityId, revision });
  api.loadTool.mockResolvedValueOnce({ ...base, version: "0.3.0" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Replace current draft" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("workbench changed"));
  expect(editor("text").value).toBe("edits after selection");
  expect(api.invoke).not.toHaveBeenCalled();
});
