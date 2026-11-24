import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolDirectory } from "./ManualToolDirectory";
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
  const directory = (workspaceId: string, gateway: ManualToolApi = api) => (
    <ManualToolDirectory
      api={gateway}
      scope={{ ...scope, workspaceId }}
      openApplication={() => undefined}
    />
  );
  const view = render(directory(scope.workspaceId));
  const switchWorkspace = (workspaceId: string) => view.rerender(directory(workspaceId));
  const switchApi = () => view.rerender(directory(scope.workspaceId, { ...api }));
  return { api, switchWorkspace, switchApi };
}

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
  await act(async () => {
    fireEvent.click(within(card).getByRole("button", { name: "Open tool" }));
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
