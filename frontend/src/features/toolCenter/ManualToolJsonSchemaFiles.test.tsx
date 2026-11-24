import { File as NodeFile } from "node:buffer";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

const tool: ManualTool = {
  toolId: "json-schema",
  accessId: "json-schema",
  pluginId: "com.zicode.devtools.json-schema",
  capabilityId: "devtools.json-schema.validate",
  title: "JSON Schema 校验",
  applicationName: "JSON Schema",
  publisher: "Studio fixture",
  version: "0.1.0",
  enabled: true,
  runtime: "wasi",
};
const schema = {
  type: "object",
  properties: {
    instance: { type: "string", maxLength: 8192 },
    schema: { type: "string", maxLength: 8192 },
  },
  required: ["instance", "schema"],
  additionalProperties: false,
};

afterEach(cleanup);

async function openTool(inputSchema: unknown = schema) {
  setLocale("zh-CN");
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId,
      version: tool.version,
      revision: "schema-fixture",
      enabled: true,
      capability: { id: tool.capabilityId, inputSchema },
      permissions: [],
    })),
    invoke: vi.fn(),
  };
  const view = render(
    <ManualToolDetail
      tool={tool}
      revision="schema-fixture"
      scope={{ sceneId: "programming", workspaceId: "workspace" }}
      api={api}
    />,
  );
  const form = within(await view.findByRole("form", { name: "工具输入" }));
  const inputs = {
    instance: form.getByRole<HTMLTextAreaElement>("textbox", { name: /待校验 JSON/ }),
    schema: form.getByRole<HTMLTextAreaElement>("textbox", { name: /JSON Schema/ }),
  };
  const pickers = {
    instance: form.getByLabelText<HTMLInputElement>("待校验 JSON 文件", { exact: true }),
    schema: form.getByLabelText<HTMLInputElement>("JSON Schema 文件", { exact: true }),
  };
  const pick = async (field: keyof typeof inputs, ...files: NodeFile[]) => {
    await act(async () => {
      fireEvent.change(pickers[field], { target: { files } });
    });
  };
  const undo = async () => {
    await act(async () => {
      fireEvent.click(form.getByRole("button", { name: "撤销上次导入" }));
    });
  };
  const run = async () => {
    await act(async () => {
      fireEvent.click(form.getByRole("button", { name: "执行工具" }));
    });
  };
  return { ...view, api, form, inputs, pickers, pick, undo, run };
}

const file = (name: string, text: string) => new NodeFile([text], name);

it("imports the two JSON drafts separately, preserving the other side on cancel or undo", async () => {
  const { api, inputs, pickers, pick, undo } = await openTool();
  expect(pickers.instance.accept).toBe(".json");
  expect(pickers.schema.accept).toBe(".json");
  fireEvent.change(inputs.instance, { target: { value: "old instance" } });
  fireEvent.change(inputs.schema, { target: { value: "old schema" } });
  const importedInstance = '{"amount":18446744073709551615}';
  const importedSchema = '{"type":"object"}';
  await pick("schema", file("root.JSON", importedSchema));
  await pick("instance", file("data.json", "\uFEFF" + importedInstance));
  await pick("instance");
  expect(inputs.instance.value).toBe(importedInstance);
  expect(inputs.schema.value).toBe(importedSchema);
  await undo();
  expect(inputs.instance.value).toBe("old instance");
  expect(inputs.schema.value).toBe(importedSchema);

  await pick("instance", file("data.json", importedInstance));
  await pick("schema", file("updated.json", "{}"));
  await undo();
  expect(inputs.instance.value).toBe(importedInstance);
  expect(inputs.schema.value).toBe(importedSchema);
  expect(api.invoke).not.toHaveBeenCalled();
});

it("retains both drafts after JSON file read errors and enforces 8 KiB on each side", async () => {
  const { api, getByRole, inputs, pick } = await openTool();
  const exact = "{}" + " ".repeat(8190);
  await pick("instance", file("data.json", exact));
  await pick("schema", file("root.json", exact));
  const inputsBefore = [inputs.instance.value, inputs.schema.value];
  expect(inputsBefore).toEqual([exact, exact]);
  const invalid = new NodeFile([new Uint8Array([0xff])], "invalid.json");
  await pick("instance", invalid);
  expect(getByRole("alert").textContent).toBe("文件必须使用有效的 UTF-8 编码。");
  await pick("schema", file("too-big.json", exact + " "));
  expect(getByRole("alert").textContent).toBe("JSON 文件不能超过 8 KiB。");
  const unreadable = file("unreadable.json", "{}");
  vi.spyOn(unreadable, "slice").mockImplementation(() => {
    throw Error("unavailable");
  });
  await pick("schema", unreadable);
  expect(getByRole("alert").textContent).toBe("无法读取 JSON 文件。");
  expect([inputs.instance.value, inputs.schema.value]).toEqual(inputsBefore);
  expect(api.invoke).not.toHaveBeenCalled();
});

const candidate = process.env.ZICODE_TEST_JSON_SCHEMA_PACKAGE;
const worker = process.env.ZICODE_TEST_COMPARE_WORKER;

it.runIf(Boolean(candidate && worker))(
  "executes both imported drafts and their explicit Draft through the frozen production WIN Worker",
  async () => {
    if (!candidate || !worker) throw Error("Frozen Worker fixture missing");
    const manifest = JSON.parse(readFileSync(join(candidate, "plugin.json"), "utf8"));
    const capability = manifest.contributes.capabilities[0];
    expect([manifest.id, capability.id]).toEqual([tool.pluginId, tool.capabilityId]);
    const { api, inputs, pick, undo, run, container } = await openTool(capability.inputSchema);
    vi.mocked(api.invoke).mockImplementation(
      async (sceneId, _workspaceId, pluginId, capabilityId, input) => {
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
    );
    const instance = '{"项目/名~":"private-fixture"}';
    const draft4 =
      '{"$schema":"http://json-schema.org/draft-04/schema#","if":{"type":"object"},"then":{"required":["missing"]}}';
    const draft7 =
      '{"$schema":"http://json-schema.org/draft-07/schema#","definitions":{"amount":{"type":"integer"}},"properties":{"项目/名~":{"$ref":"#/definitions/amount"}}}';
    await pick("schema", file("draft4.json", draft4));
    await pick("instance", file("data.json", instance));
    expect(api.invoke).not.toHaveBeenCalled();
    await run();
    const report = () => container.querySelector<HTMLTextAreaElement>("[data-tool-result]")?.value;
    expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ instance, schema: draft4 });
    expect(report()).toContain("校验通过");

    await pick("schema", file("draft7.json", draft7));
    await run();
    expect(vi.mocked(api.invoke).mock.calls[1][4]).toEqual({ instance, schema: draft7 });
    expect(report()).toContain("/项目~1名~0");
    expect(report()).not.toContain("private-fixture");

    const external = '{"$ref":"nearby.json"}';
    await pick("schema", file("cross-file.json", external));
    await run();
    expect(vi.mocked(api.invoke).mock.calls[2][4]).toEqual({ instance, schema: external });
    expect(within(container).getByRole("alert").textContent).toContain("已拒绝引用");
    await undo();
    expect(inputs.schema.value).toBe(draft7);
    expect(inputs.instance.value).toBe(instance);
    expect(api.invoke).toHaveBeenCalledTimes(3);
  },
  20000,
);
