import { spawnSync } from "node:child_process";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";
import { prepareTransformApply } from "./data-transform-apply";
import { dataTransformPreview } from "./data-transform-result";
import { manualToolResult } from "./manual-tool-result";

const prefix = "devtools.compute.transform.";
const input = "  label  ,amount,extra\r\n  Text  ,9223372036854775807,";
const options = ' { "format" : "csv", "column" : "amount" } ';
const exactTable =
  '{"headers":["  label  ","amount","extra"],"rows":[["  Text  ",9223372036854775807,{"n":18446744073709551615}]]}';
const response = (data: string, changed = 1, examples: [string, string][] = []) => ({
  contractVersion: "1.0.0-rc.1",
  ok: true,
  data: {
    text: `{"data":${data},"changed":${changed},"examples":${JSON.stringify(examples)},"csv":""}`,
  },
  error: null,
});
const failed = {
  contractVersion: "1.0.0-rc.1",
  ok: false,
  data: null,
  error: { code: "INVALID_INPUT", message: "Domain failure" },
};

beforeEach(() => setLocale("en"));
afterEach(cleanup);

function mount(handler: ManualToolApi["invoke"] = async () => ({ result: response(exactTable) })) {
  const tool: ManualTool = {
    toolId: "compute/integer",
    accessId: "compute:integer",
    pluginId: "com.zicode.devtools.compute",
    capabilityId: prefix + "integer",
    title: "Integer column",
    applicationName: "Compute",
    publisher: "Zicode",
    version: "0.2.0",
    enabled: true,
    runtime: "wasi",
  };
  const api = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({
      pluginId: tool.pluginId,
      version: tool.version,
      revision: "revision",
      enabled: true,
      permissions: [],
      capability: {
        id: tool.capabilityId,
        inputSchema: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: {
            text: { type: "string", maxLength: 8192 },
            options: { type: "string", maxLength: 16384 },
          },
        },
      },
    })),
    invoke: vi.fn(handler),
  };
  const props = {
    tool,
    api,
    revision: "revision",
    scope: { sceneId: "programming", workspaceId: "workspace" },
  };
  const view = render(<ManualToolDetail {...props} />);
  return { api, view, props };
}
async function fill(text = input, settings = options) {
  const source = (await screen.findByLabelText(/Input text/)) as HTMLTextAreaElement;
  const opts = screen.getByLabelText("options") as HTMLTextAreaElement;
  fireEvent.change(source, { target: { value: text } });
  fireEvent.change(opts, { target: { value: settings } });
  return { source, opts };
}
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const run = () => fireEvent.click(button("Execute tool"));

it("only applies after a click, preserves exact values and restores the original text and options on undo", async () => {
  const { api } = mount();
  const { source, opts } = await fill();
  const before = source.value; // Textareas normalize line endings before the Host receives them.
  run();
  const apply = await screen.findByRole("button", { name: "Apply to input" });
  await waitFor(() => expect(button("Apply to input").disabled).toBe(false));
  expect(source.value).toBe(before);
  expect(opts.value).toBe(options);
  expect(screen.queryByRole("button", { name: "Undo last application" })).toBeNull();

  fireEvent.click(apply);
  expect(source.value).toBe(exactTable);
  expect(JSON.parse(opts.value)).toEqual({ format: "json", column: "amount" });
  expect((screen.getByLabelText("Original response") as HTMLTextAreaElement).value).toBe(
    manualToolResult(response(exactTable)).raw,
  );
  expect(api.invoke).toHaveBeenCalledTimes(1);

  api.invoke.mockResolvedValueOnce({ result: failed });
  run();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Domain failure"));
  expect(api.invoke.mock.calls[1][4]).toEqual({ text: exactTable, options: opts.value });
  fireEvent.click(button("Undo last application"));
  expect(source.value).toBe(before);
  expect(opts.value).toBe(options);
  expect(screen.queryByRole("button", { name: "Undo last application" })).toBeNull();
  expect(api.invoke).toHaveBeenCalledTimes(2);
});

it("blocks stale application and releases undo after a manual edit", async () => {
  mount();
  const { source, opts } = await fill();
  run();
  await waitFor(() => expect(button("Apply to input").disabled).toBe(false));
  fireEvent.change(opts, { target: { value: '{"format":"csv","column":"extra"}' } });
  expect(button("Apply to input").disabled).toBe(true);
  expect(source.value).not.toBe(exactTable);

  fireEvent.change(opts, { target: { value: options } });
  expect(button("Apply to input").disabled).toBe(true);
  run();
  await waitFor(() => expect(button("Apply to input").disabled).toBe(false));
  fireEvent.click(button("Apply to input"));
  expect(button("Undo last application")).toBeTruthy();
  fireEvent.change(source, { target: { value: "my edited draft" } });
  expect(screen.queryByRole("button", { name: "Undo last application" })).toBeNull();
  expect(source.value).toBe("my edited draft");
});

it("rejects a late result from another workspace and catalog revision", async () => {
  let deliver: (result: { result: ReturnType<typeof response> }) => void = () => {};
  const { api, view, props } = mount(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const { source } = await fill();
  const before = source.value;
  run();
  await waitFor(() => expect(api.invoke).toHaveBeenCalledOnce());
  view.rerender(
    <ManualToolDetail
      {...props}
      revision="updated"
      scope={{ ...props.scope, workspaceId: "other" }}
    />,
  );
  deliver({ result: response(exactTable) });
  await screen.findByRole("button", { name: "Apply to input" });
  expect(button("Apply to input").disabled).toBe(true);
  expect(source.value).toBe(before);
});

it("keeps duplicate or oversized output from becoming input", async () => {
  const { api } = mount();
  const { source } = await fill();
  const before = source.value;
  api.invoke.mockResolvedValueOnce({
    result: response('{"headers":["amount","amount"],"rows":[[1,2]]}'),
  });
  run();
  await screen.findByLabelText("Tool result");
  expect(screen.queryByRole("button", { name: "Apply to input" })).toBeNull();
  expect(source.value).toBe(before);
  api.invoke.mockResolvedValueOnce({
    result: response(JSON.stringify({ headers: ["amount"], rows: [["语".repeat(2800)]] })),
  });
  run();
  await screen.findByRole("button", { name: "Apply to input" });
  expect(button("Apply to input").disabled).toBe(true);
  expect(source.value).toBe(before);
});

it("offers a preview without rewriting input when a returned table lacks the declared contract", async () => {
  mount(async () => ({
    result: {
      data: { headers: ["amount"], rows: [[42]] },
      changed: 1,
      examples: [],
      csv: "amount\n42",
    },
  }));
  const { source } = await fill();
  const before = source.value;
  run();
  await screen.findByRole("table");
  expect(button("Apply to input").disabled).toBe(true);
  expect(source.value).toBe(before);
});

it("preserves a valid long column name and rejects a typed table whose UTF-8 serialization exceeds the input limit", () => {
  const name = "标签".repeat(90);
  const normal = dataTransformPreview(
    response(JSON.stringify({ headers: [name], rows: [["same"]] })).data.text,
  );
  if (!normal) throw Error("Invalid long-column fixture");
  const settings = { options: JSON.stringify({ format: "csv", column: name }) };
  expect(prepareTransformApply(prefix + "trim", settings, normal)?.text).toBe(
    JSON.stringify({ headers: [name], rows: [["same"]] }),
  );
  const oversized = dataTransformPreview(
    response(JSON.stringify({ headers: [name], rows: [["值".repeat(2700)]] })).data.text,
  );
  if (!oversized) throw Error("Invalid long-column size fixture");
  expect(prepareTransformApply(prefix + "trim", settings, oversized)).toBeNull();
});

it("keeps rename and retained columns valid and accepts an empty typed table", () => {
  const rename = dataTransformPreview(
    response('{"headers":["renamed"],"rows":[]}', 1, [["original", "renamed"]]).data.text,
  );
  if (!rename) throw Error("Invalid rename fixture");
  const renamed = prepareTransformApply(
    prefix + "rename",
    { options: '{"format":"tsv","column":"original","value":"renamed"}' },
    rename,
  );
  expect(renamed?.text).toBe('{"headers":["renamed"],"rows":[]}');
  expect(renamed && JSON.parse(renamed.options)).toEqual({
    format: "json",
    column: "renamed",
    value: "renamed",
  });
  expect(
    prepareTransformApply(
      prefix + "select",
      { options: '{"format":"csv","column":"","keep":["renamed"]}' },
      rename,
    )?.text,
  ).toBe('{"headers":["renamed"],"rows":[]}');
  expect(prepareTransformApply(prefix + "unknown", { options }, rename)).toBeNull();
});

const worker = process.env.ZICODE_TEST_TRANSFORM_WORKER;
const modulePath = process.env.ZICODE_TEST_TRANSFORM_MODULE;
it.runIf(Boolean(worker && modulePath))(
  "resubmits the applied React draft through the frozen Windows Worker",
  async () => {
    const { api } = mount(async (...args) => {
      const body = spawnSync(worker as string, ["--zicode-plugin-worker"], {
        input: JSON.stringify({
          workerPath: modulePath,
          workerKind: "wasi",
          pluginId: args[2],
          capabilityId: args[3],
          sceneId: args[0],
          input: args[4],
        }),
        windowsHide: true,
        encoding: "utf8",
        timeout: 15000,
      });
      expect(body.status).toBe(0);
      const result = JSON.parse(body.stdout);
      expect(result.result?.ok).toBe(true);
      return result;
    });
    const { source, opts } = await fill(
      "amount,tag\n9223372036854775807,a\n-9223372036854775808,b",
      options,
    );
    const before = source.value;
    run();
    await waitFor(() => expect(button("Apply to input").disabled).toBe(false));
    fireEvent.click(button("Apply to input"));
    expect(source.value).toContain("9223372036854775807");
    expect(source.value).toContain("-9223372036854775808");
    const newInput = source.value;
    run();
    await screen.findByText("The result already matches the input.");
    expect(api.invoke.mock.calls[1][4]).toEqual({ text: newInput, options: opts.value });
    fireEvent.click(button("Undo last application"));
    expect(source.value).toBe(before);
    expect(opts.value).toBe(options);
  },
  40_000,
);
