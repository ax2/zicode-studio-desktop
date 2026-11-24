import { File as NodeFile } from "node:buffer";
import { spawnSync } from "node:child_process";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
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

function mount(handler: ManualToolApi["invoke"] = async () => ({ result: response(exactTable) }), capabilityId = prefix + "integer") {
  const tool: ManualTool = {
    toolId: "compute/integer",
    accessId: "compute:integer",
    pluginId: "com.zicode.devtools.compute",
    capabilityId,
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


function importFile(file: { name: string; size: number; slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> } }, label = "Table file") {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}

it("imports a selected UTF-8 table without executing and restores the previous draft on undo", async () => {
  const { api } = mount();
  const { source, opts } = await fill("Original draft", '{ "format": "csv", "column": "amount" }');
  const originalOptions = opts.value;
  const tsv = "amount\t名称\r\n9223372036854775807\t甲";
  importFile(new NodeFile(["\uFEFF", tsv], "sample.TSV"));

  await screen.findByRole("button", { name: "Undo last import" });
  expect(source.value).toBe(tsv.replace(/\r\n/g, "\n"));
  expect(JSON.parse(opts.value)).toEqual({ format: "tsv", column: "amount" });
  expect(api.invoke).not.toHaveBeenCalled();

  run();
  await waitFor(() => expect(api.invoke).toHaveBeenCalledTimes(1));
  expect(api.invoke.mock.calls[0][4]).toEqual({ text: tsv, options: opts.value });
  await waitFor(() => expect(button("Undo last import").disabled).toBe(false));
  fireEvent.click(button("Undo last import"));
  expect(source.value).toBe("Original draft");
  expect(opts.value).toBe(originalOptions);
});

it.each([
  ["encoding.csv", [new Uint8Array([0xff])], options, "The file must contain valid UTF-8 text."],
  ["large.csv", ["字".repeat(2731)], options, "Table files must be 8 KiB or smaller."],
  ["empty.tsv", ["  \r\n"], options, "The selected table file is empty."],
  ["notes.txt", ["amount\n1"], options, "Choose a CSV, TSV, or JSON file."],
  ["valid.csv", ["amount\n1"], "{unfinished", "Fix the tool options before importing a file."],
] as const)("retains the draft when %s cannot be imported", async (name, content, settings, message) => {
  const { api } = mount();
  const { source, opts } = await fill("My original draft", settings);
  importFile(new NodeFile([...content], name));
  expect((await screen.findByRole("alert")).textContent).toBe(message);
  expect(source.value).toBe("My original draft");
  expect(opts.value).toBe(settings);
  expect(api.invoke).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Undo last import" })).toBeNull();
});

it("keeps the draft when an otherwise valid file cannot be read", async () => {
  mount();
  const { source, opts } = await fill("Original draft");
  importFile({ name: "locked.csv", size: 12, slice: () => ({ arrayBuffer: () => Promise.reject(Error("Read failed")) }) });
  expect((await screen.findByRole("alert")).textContent).toBe("Could not read the table file.");
  expect(source.value).toBe("Original draft");
  expect(opts.value).toBe(options);
});


it("does not apply an in-flight file read after the tool scope changes", async () => {
  const { props, view } = mount();
  const { source } = await fill("Current draft");
  let finish: (bytes: ArrayBuffer) => void = () => { throw Error("The file was not read"); };
  const pending = new Promise<ArrayBuffer>(resolve => { finish = resolve; });
  const file = { name: "table.csv", size: 16, slice: () => ({ arrayBuffer: () => pending }) };
  importFile(file);
  expect(button("Reading table file…").disabled).toBe(true);
  view.rerender(<ManualToolDetail {...props} scope={{ ...props.scope, workspaceId: "next" }} />);
  await screen.findByRole("button", { name: "Import table file…" });
  await act(async () => {
    finish(new TextEncoder().encode("amount\n1").buffer);
    await pending;
  });
  expect(button("Import table file…").disabled).toBe(false);
  expect(source.value).toBe("Current draft");
  expect(screen.queryByRole("button", { name: "Undo last import" })).toBeNull();
});


it("does not present importing a new draft as applying a previous result", async () => {
  mount();
  await fill();
  run();
  await screen.findByRole("table");

  importFile(new NodeFile(["amount\n5"], "new.csv"));
  await screen.findByRole("button", { name: "Undo last import" });
  expect(screen.queryByText("Applied to the input as a JSON table.")).toBeNull();
  expect(button("Apply to input").disabled).toBe(true);
});


it("accepts exactly 8 KiB of UTF-8 table data", async () => {
  mount();
  const { source } = await fill("");
  const content = "列\n" + "字".repeat(2729) + "x";
  const file = new NodeFile([content], "limit.csv");
  expect(file.size).toBe(8192);
  importFile(file);
  await screen.findByRole("button", { name: "Undo last import" });
  expect(source.value).toBe(content);
});

it("imports and undoes the two tables without changing join keys or running automatically", async () => {
  const { api } = mount(undefined, "devtools.compute.merge.left");
  const left = "id,name\r\n1,甲";
  const right = "id,team\r\n1,组";
  const { source, opts } = await fill("", '{"left_key":"id","right_key":"id"}');
  importFile(new NodeFile(["\uFEFF", left], "left.CSV"), "Left table file");
  await waitFor(() => expect(source.value).toBe("id,name\n1,甲"));
  const beforeRight = opts.value;

  importFile(new NodeFile(["id\tteam\n1\t组"], "right.tsv"), "Right table file");
  expect((await screen.findByRole("alert")).textContent).toBe("Both tables must use the same file format.");
  expect(opts.value).toBe(beforeRight);

  importFile(new NodeFile([right], "right.csv"), "Right table file");
  await waitFor(() => expect(JSON.parse(opts.value).right).toBe(right));
  expect(api.invoke).not.toHaveBeenCalled();
  expect(JSON.parse(opts.value)).toEqual({ format: "csv", left_key: "id", right_key: "id", right });

  fireEvent.change(screen.getByLabelText("Right table file"), { target: { files: [] } });
  expect(JSON.parse(opts.value).right).toBe(right);
  run();
  await waitFor(() => expect(button("Undo last import").disabled).toBe(false));
  expect(api.invoke.mock.calls[0][4]).toEqual({ text: left, options: opts.value });
  fireEvent.click(button("Undo last import"));
  expect(source.value).toBe("id,name\n1,甲");
  expect(opts.value).toBe(beforeRight);
});

it("retains the existing two tables if the encoded right-table options would exceed the Worker budget", async () => {
  mount(undefined, "devtools.compute.merge.inner");
  const settings = '{"format":"csv","left_key":"id","right_key":"id","right":"id\n1"}'.replace(/\n/g, "\\n");
  const { source, opts } = await fill("id\n1", settings);
  importFile(new NodeFile(['"'.repeat(8192)], "right.csv"), "Right table file");
  expect((await screen.findByRole("alert")).textContent).toBe("Tool options must be 16 KiB or smaller.");
  expect(opts.value).toBe(settings);
  expect(source.value).toBe("id\n1");
});

const worker = process.env.ZICODE_TEST_TRANSFORM_WORKER;
const modulePath = process.env.ZICODE_TEST_TRANSFORM_MODULE;
const runFrozenWorker: ManualToolApi["invoke"] = async (sceneId, _workspaceId, pluginId, capabilityId, input) => {
  const body = spawnSync(worker as string, ["--zicode-plugin-worker"], {
    input: JSON.stringify({ workerPath: modulePath, workerKind: "wasi", pluginId, capabilityId, sceneId, input }),
    windowsHide: true,
    encoding: "utf8",
    timeout: 15000,
  });
  expect(body.status).toBe(0);
  const result = JSON.parse(body.stdout);
  expect(result.result?.ok).toBe(true);
  return result;
};

it.runIf(Boolean(worker && modulePath))(
  "imports all three table formats through the frozen Windows Worker",
  async () => {
    const { api } = mount(runFrozenWorker);
    const { source, opts } = await fill("", options);
    importFile(new NodeFile(["amount,tag\n9223372036854775807,a\n-9223372036854775808,b"], "fixed.csv"));
    await screen.findByRole("button", { name: "Undo last import" });
    expect(api.invoke).not.toHaveBeenCalled();
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

    const tsv = "amount\ttag\r\n9223372036854775807\ta\r\n-9223372036854775808\tb";
    importFile(new NodeFile([tsv], "fixed.tsv"));
    await screen.findByRole("button", { name: "Undo last import" });
    run();
    await waitFor(() => expect(button("Execute tool").disabled).toBe(false));
    expect(api.invoke.mock.calls[2][4]).toEqual({ text: tsv, options: '{"format":"tsv","column":"amount"}' });

    importFile(new NodeFile([newInput], "fixed.json"));
    await waitFor(() => expect(JSON.parse(opts.value).format).toBe("json"));
    run();
    await screen.findByText("The result already matches the input.");
    expect(api.invoke.mock.calls[3][4]).toEqual({ text: newInput, options: opts.value });
  },
  40_000,
);
it.runIf(Boolean(worker && modulePath)).each([
  {
    mode: "left", format: "csv", left: "id,name\n1,A\n2,B", right: "id,name\n1,X\n1,Y",
    csv: "id,name,id_right1,name_right1\n1,A,1,X\n1,A,1,Y\n2,B,,\n",
  },
  {
    mode: "inner", format: "tsv", left: "id\tname\n1\tA\n2\tB", right: "id\tname\n1\tX\n1\tY",
    csv: "id,name,id_right1,name_right1\n1,A,1,X\n1,A,1,Y\n",
  },
  {
    mode: "append", format: "json",
    left: '{"headers":["id","name"],"rows":[["1","A"],["2","B"]]}',
    right: '{"headers":["name","id"],"rows":[["X","3"],["Y","4"]]}',
    csv: "id,name\n1,A\n2,B\n3,X\n4,Y\n",
  },
  {
    mode: "columns", format: "csv", left: "id,name\n1,A\n2,B", right: "name,id\nX,3\nY,4",
    csv: "id,name,name_right1,id_right1\n1,A,X,3\n2,B,Y,4\n",
  },
])("imports both files for $mode in the frozen Windows Worker", async ({ mode, format, left, right, csv }) => {
  const { api } = mount(runFrozenWorker, "devtools.compute.merge." + mode);
  const { source, opts } = await fill("", '{"left_key":"id","right_key":"id"}');
  importFile(new NodeFile([right], "right." + format), "Right table file");
  await waitFor(() => expect(JSON.parse(opts.value).right).toBe(right));
  importFile(new NodeFile([left], "left." + format), "Left table file");
  await waitFor(() => expect(source.value).toBe(left));

  expect(api.invoke).not.toHaveBeenCalled();
  run();
  await screen.findByText("Tool completed");
  expect(api.invoke.mock.calls[0][4]).toEqual({ text: left, options: opts.value });
  const response = JSON.parse((screen.getByLabelText("Original response") as HTMLTextAreaElement).value);
  expect(JSON.parse(response.data.text).csv).toBe(csv);
}, 25_000);

it.each(["csv", "tsv", "json"] as const)("imports only a %s quality file and restores the draft on undo", async format => {
  const { api } = mount(undefined, "devtools.compute.quality." + format);
  const { source, opts } = await fill("Original draft", "");
  const picker = screen.getByLabelText("Table file") as HTMLInputElement;
  expect(picker.accept).toBe("." + format);

  importFile(new NodeFile(["table data"], "wrong.txt"));
  expect((await screen.findByRole("alert")).textContent).toBe("Choose a " + format.toUpperCase() + " file.");
  expect(source.value).toBe("Original draft");
  expect(screen.queryByRole("button", { name: "Undo last import" })).toBeNull();

  const original = "[{\"amount\":9223372036854775807}]";
  importFile(new NodeFile(["\uFEFF", original], "quality." + format.toUpperCase()));
  await screen.findByRole("button", { name: "Undo last import" });
  expect(source.value).toBe(original);
  expect(opts.value).toBe("");
  fireEvent.change(picker, { target: { files: [] } });
  expect(source.value).toBe(original);
  expect(api.invoke).not.toHaveBeenCalled();

  fireEvent.click(button("Undo last import"));
  expect(source.value).toBe("Original draft");
  expect(opts.value).toBe("");
});

const qualityFixtures = [
  {
    format: "json",
    input: '[{"amount":9223372036854775807},{"amount":9223372036854775806},{"amount":" "},{"amount":null},{"amount":9223372036854775807},{}]',
    rows: 6, duplicateRowsAfterFirst: 2,
    column: { column: "amount", missingOrNull: 2, blankStrings: 1, types: { null: 2, number: 3, string: 1 }, mixedNonNullTypes: true },
  },
  ...["csv", "tsv"].map(format => {
    const delimiter = format === "csv" ? "," : "\t";
    return {
      format, input: [["城市", "标签"], ["广州", "a"], ["广州", "a"], ["北京", " "]].map(row => row.join(delimiter)).join("\r\n"),
      rows: 3, duplicateRowsAfterFirst: 1,
      column: { column: "标签", missingOrNull: 0, blankStrings: 1, types: { string: 3 }, mixedNonNullTypes: false },
    };
  }),
];

it.runIf(Boolean(worker && modulePath)).each(qualityFixtures)(
  "imports a $format file and reports quality through the frozen Windows Worker",
  async ({ format, input, rows, duplicateRowsAfterFirst, column }) => {
    const { api } = mount(runFrozenWorker, "devtools.compute.quality." + format);
    await fill("", "");
    importFile(new NodeFile([input], "quality." + format));
    await screen.findByRole("button", { name: "Undo last import" });
    expect(api.invoke).not.toHaveBeenCalled();

    run();
    await screen.findByText("Tool completed");
    expect(api.invoke.mock.calls[0][4]).toEqual({ text: input });
    const response = JSON.parse((screen.getByLabelText("Original response") as HTMLTextAreaElement).value);
    expect(JSON.parse(response.data.text)).toMatchObject({
      rows, duplicateRowsAfterFirst, columns: expect.arrayContaining([column]),
    });
  }, 25_000,
);

const workbenchFileCases = [
  {
    operation: "json", inputFormat: "csv", input: 'name,city\r\n"张,三",北京\r\n李四,上海',
    settings: { query: "北京", sort: "name", descending: false },
    inputRows: 2, selectedRows: 1, outputFormat: "json", output: [{ name: "张,三", city: "北京" }],
  },
  {
    operation: "csv", inputFormat: "json",
    input: '[{"id":9223372036854775807,"name":"甲"},{"id":-9223372036854775808,"name":"乙"},{"id":18446744073709551615,"name":"丙"}]',
    settings: { descending: false }, inputRows: 3, selectedRows: 3, outputFormat: "csv",
    output: "id,name\n9223372036854775807,甲\n-9223372036854775808,乙\n18446744073709551615,丙\n",
  },
  {
    operation: "query", inputFormat: "tsv", input: "id\t姓名\r\n1\t甲\r\n3\t乙\r\n2\t甲乙",
    settings: { query: "甲", sort: "id", descending: true, output: "tsv" },
    inputRows: 3, selectedRows: 2, outputFormat: "tsv", output: "id\t姓名\n2\t甲乙\n1\t甲\n",
  },
];

it.each(workbenchFileCases)("imports $inputFormat for the workbench $operation without applying it", async ({
  operation, inputFormat, input, settings,
}) => {
  const { api } = mount(undefined, "devtools.compute.table." + operation);
  const previousOptions = " " + JSON.stringify({ format: inputFormat === "csv" ? "json" : "csv", ...settings }) + " ";
  const { source, opts } = await fill("Previous draft", previousOptions);
  importFile(new NodeFile(["\uFEFF", input], "table." + inputFormat.toUpperCase()));
  const undo = await screen.findByRole("button", { name: "Undo last import" });
  expect(source.value).toBe(input.replaceAll("\r\n", "\n"));
  expect(JSON.parse(opts.value)).toEqual({ format: inputFormat, ...settings });
  expect(api.invoke).not.toHaveBeenCalled();
  fireEvent.click(undo);
  expect(source.value).toBe("Previous draft");
  expect(opts.value).toBe(previousOptions);
});

it("preserves the workbench draft when its sort direction is not a boolean", async () => {
  const { api } = mount(undefined, "devtools.compute.table.query");
  const settings = '{"format":"csv","descending":"false"}';
  const { source, opts } = await fill("Previous draft", settings);
  importFile(new NodeFile(["id\n1"], "table.csv"));
  expect((await screen.findByRole("alert")).textContent).toBe("Fix the tool options before importing a file.");
  expect(source.value).toBe("Previous draft");
  expect(opts.value).toBe(settings);
  expect(api.invoke).not.toHaveBeenCalled();
});

// The 0.1 series does not declare any workbench capabilities.
const hasWorkbench = worker && modulePath && process.env.ZICODE_TEST_COMPUTE_WORKBENCH === "1";
it.runIf(Boolean(hasWorkbench)).each(workbenchFileCases)(
  "imports $inputFormat and runs the workbench $operation through the frozen Windows Worker",
  async ({ operation, inputFormat, input, settings, inputRows, selectedRows, outputFormat, output }) => {
    const { api } = mount(runFrozenWorker, "devtools.compute.table." + operation);
    const { opts } = await fill("", JSON.stringify(settings));
    importFile(new NodeFile([input], "table." + inputFormat));
    await screen.findByRole("button", { name: "Undo last import" });
    expect(api.invoke).not.toHaveBeenCalled();
    run();
    await screen.findByText("Tool completed");
    expect(api.invoke.mock.calls[0][4]).toEqual({ text: input, options: opts.value });
    expect(JSON.parse(opts.value)).toEqual({ format: inputFormat, ...settings });
    const response = JSON.parse((screen.getByLabelText("Original response") as HTMLTextAreaElement).value);
    const report = JSON.parse(response.data.text);
    expect(report).toMatchObject({ inputRows, selectedRows, format: outputFormat });
    expect(outputFormat === "json" ? JSON.parse(report.text) : report.text).toEqual(output);
  }, 25_000,
);
