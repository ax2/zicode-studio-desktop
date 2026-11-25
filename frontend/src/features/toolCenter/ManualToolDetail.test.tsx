import { File as NodeFile } from "node:buffer";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, within } from "@testing-library/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import * as downloads from "../../shared/download-file";
import { setLocale } from "../../shared/i18n";
import { emptyAccess } from "../commandPalette/tool-access";
import { ManualToolDetail } from "./ManualToolDetail";
import type { ManualTool, ManualToolApi } from "./manual-tools";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); });
const tool: ManualTool = { toolId: "tool", accessId: "access", pluginId: "fixture", capabilityId: "decode", title: "Decode",
  applicationName: "Fixture", publisher: "Studio", version: "0.1.0", enabled: true, runtime: "wasi" };
const envelope = (text: string) => ({ contractVersion: "1.0.0-rc.1", ok: true, data: { text }, error: null });
async function mount(activeTool: ManualTool = tool, resourceInputProfile?: string, inputSchema: unknown = { type: "object", properties: { text: { type: "string" } } }, onOpenApplication?: () => void) {
  setLocale("zh-CN");
  const api: ManualToolApi = {
    searchTools: vi.fn(),
    loadTool: vi.fn(async () => ({ pluginId: activeTool.pluginId, version: activeTool.version, revision: "revision", enabled: activeTool.enabled,
      resourceInputProfile, capability: { id: activeTool.capabilityId, inputSchema },
      permissions: resourceInputProfile ? [{ name: "resource.read", granted: true, required: false, reason: "" }] : [] })),
    invoke: vi.fn(async () => ({ result: envelope("中\nnext\n") })),
  };
  const store = { read: vi.fn(async () => emptyAccess()), mutate: vi.fn(async () => emptyAccess()) };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  const renderScope = async (workspaceId: string, selected = activeTool, revision = "revision") => {
    await act(async () => root.render(<ManualToolDetail tool={selected} revision={revision} api={api}
      scope={{ sceneId: "programming", workspaceId }} accessStore={store} onOpenApplication={onOpenApplication} />));
  };
  await renderScope("workspace");
  const submit = async () => { await act(async () => container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); };
  return { container, api, store, submit, renderScope };
}

it("keeps object input editable for a disabled plugin and explains the actual blocker", async () => {
  const disabled = await mount({ ...tool, enabled: false }, undefined,
    { type: "object", properties: { value: { type: "object", maxProperties: 128 } }, required: ["value"], additionalProperties: false });
  expect(disabled.container.querySelector("form textarea")).toBeTruthy();
  expect(disabled.container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  expect(disabled.container.textContent).toContain("请先在插件管理中启用此插件");
  expect(disabled.container.textContent).not.toContain("通用表单无法执行");
});

it("routes only fixed built-in resource receivers to the trusted resource UI", async () => {
  const receiver = { ...tool, runtime: "builtin" as const, pluginId: "com.zicode.ocr", capabilityId: "ocr.resource-text" };
  const allowed = await mount(receiver, "resource.host.ocr-input.v1");
  expect(allowed.container.querySelector(".directory-resource-tool")).toBeTruthy();
  expect(allowed.container.textContent).not.toContain("通用表单无法执行");
  const unsupported = await mount({ ...receiver, pluginId: "other" }, "resource.host.ocr-input.v1");
  expect(unsupported.container.querySelector(".directory-resource-tool")).toBeNull();
  expect(unsupported.container.textContent).toContain("通用表单无法执行");
});

it("shows exact readable text, collapsed original response and records successful use", async () => {
  const { container, store, submit } = await mount(); await submit();
  expect((container.querySelector("[data-tool-result]") as HTMLTextAreaElement).value).toBe("中\nnext\n");
  expect(container.textContent).toContain("工具执行成功");
  expect(container.querySelector("details")?.open).toBe(false);
  expect(store.mutate).toHaveBeenCalledWith({ sceneId: "programming", workspaceId: "workspace" }, { kind: "recentRecord", id: "access" });
});

it("downloads an empty successful URL decode only after the imported text is run", async () => {
  const download = vi.spyOn(downloads, "downloadFile").mockImplementation(() => {});
  try {
    const { container, api, submit } = await mount({ ...tool, pluginId: "com.zicode.devtools.transforms",
      capabilityId: "devtools.transforms.url.decode", version: "0.1.1" }, undefined,
    { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 8192 } }, additionalProperties: false });
    const view = within(container);
    vi.mocked(api.invoke).mockResolvedValue({ result: envelope("") });
    await act(async () => fireEvent.change(view.getByLabelText("UTF-8 文本文件"), { target: { files: [new NodeFile([], "empty.txt")] } }));
    expect(api.invoke).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "下载解码文本" })).toBeNull();
    await submit();
    expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: "" });
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "下载解码文本" }));
    expect(download).toHaveBeenCalledWith(expect.stringMatching(/^url-decoded-\d+\.txt$/), "", "text/plain;charset=utf-8");
  } finally { download.mockRestore(); }
});

it("replaces prior success with an escaped business error and does not record failed use", async () => {
  const { container, api, store, submit } = await mount(); await submit(); store.mutate.mockClear();
  vi.mocked(api.invoke).mockResolvedValue({ result: { contractVersion: "1.0.0-rc.1", ok: false, data: null,
    error: { code: "INVALID_ENCODING", message: "<script>not HTML</script>" } } });
  await submit();
  expect(container.querySelector("[data-tool-result]")).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("INVALID_ENCODING");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("<script>not HTML</script>");
  expect(container.querySelector("script")).toBeNull(); expect(store.mutate).not.toHaveBeenCalled();
  vi.mocked(api.invoke).mockResolvedValue({ result: envelope("recovered") }); await submit();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect((container.querySelector("[data-tool-result]") as HTMLTextAreaElement).value).toBe("recovered");
  expect(store.mutate).toHaveBeenCalledTimes(1);
});

it("clears stale output on Host failure and preserves success when history cannot save", async () => {
  const { container, api, store, submit } = await mount(); await submit(); store.mutate.mockClear();
  vi.mocked(api.invoke).mockRejectedValue({ code: "worker_timeout" }); await submit();
  expect(container.querySelector("[data-tool-result]")).toBeNull(); expect(store.mutate).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("超时");
  vi.mocked(api.invoke).mockResolvedValue({ result: envelope("success") });
  store.mutate.mockRejectedValue(new Error("history unavailable")); await submit();
  expect((container.querySelector("[data-tool-result]") as HTMLTextAreaElement).value).toBe("success");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("未能保存使用记录");
});

it("keeps tool information and the alternate application route in a collapsed disclosure", async () => {
  const open = vi.fn();
  const { container } = await mount({ ...tool, description: "Tool explanation" }, undefined, undefined, open);
  const info = container.querySelector("details.tool-information") as HTMLDetailsElement;
  expect(info).toBeTruthy(); expect(info.open).toBe(false);
  expect(info.textContent).toContain("Fixture"); expect(info.textContent).toContain("Tool explanation");
  const application = [...container.querySelectorAll("button")].find(button => button.textContent === "打开工具界面");
  expect(application?.closest("details")).toBe(info);
  await act(async () => application?.click()); expect(open).toHaveBeenCalledTimes(1);
});

it("keeps result navigation beside Run instead of inserting it before the input", async () => {
  const { container, submit } = await mount();
  expect(container.textContent).not.toContain("切换页面后工具继续运行");
  await submit();
  const form = container.querySelector("form") as HTMLFormElement;
  const button = [...form.querySelectorAll("button")].find(node => node.textContent === "查看最近执行结果");
  expect(button?.parentElement).toBe(form.querySelector('button[type="submit"]')?.parentElement);
  expect((form.querySelector("textarea")?.compareDocumentPosition(button as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.textContent).not.toContain("切换页面后工具继续运行");
});

it("shows the background-running warning only while the issued call is pending", async () => {
  const { container, api, submit } = await mount();
  let finish!: (value: { result: ReturnType<typeof envelope> }) => void;
  vi.mocked(api.invoke).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await submit();
  expect(container.textContent).toContain("切换页面后工具继续运行");
  expect(container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(true);
  await act(async () => finish({ result: envelope("done") }));
  expect(container.textContent).not.toContain("切换页面后工具继续运行");
});

it("keeps the interface as the single primary action when the tool needs its own UI", async () => {
  const open = vi.fn();
  const { container, api } = await mount({ ...tool, runtime: "builtin" }, undefined, undefined, open);
  const button = [...container.querySelectorAll("button")].find(node => node.textContent === "打开工具界面");
  expect(button).toBeTruthy(); expect(button?.closest("details")).toBeNull();
  expect(button?.classList.contains("ui-button--primary")).toBe(true);
  expect(container.querySelector("form")).toBeNull();
  await act(async () => button?.click());
  expect(open).toHaveBeenCalledTimes(1); expect(api.invoke).not.toHaveBeenCalled();
});

it("preserves the column-transform input and latest error when a partially valid table fails", async () => {
  const input = "amount,active\n42,true\ninvalid,false\n56,true";
  const options = '{"format":"csv","column":"amount"}';
  const transform = { ...tool, pluginId: "com.zicode.devtools.compute", capabilityId: "devtools.compute.transform.integer" };
  const schema = { type: "object", properties: { text: { type: "string" }, options: { type: "string" } }, required: ["text"] };
  const { api, container, store, submit } = await mount(transform, undefined, schema);
  const text = container.querySelector("textarea[id$='-text']") as HTMLTextAreaElement;
  const settings = container.querySelector("textarea[id$='-options']") as HTMLTextAreaElement;
  await act(async () => {
    fireEvent.change(text, { target: { value: input } });
    fireEvent.change(settings, { target: { value: options } });
  });
  vi.mocked(api.invoke).mockResolvedValueOnce({ result: { contractVersion: "1.0.0-rc.1", ok: false, data: null,
    error: { code: "INVALID_INPUT", message: "第 2 行，列 amount 转换失败；原数据未修改" } } });
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("第 2 条数据 · amount 列");
  expect(text.value).toBe(input);
  expect(settings.value).toBe(options);
  expect(container.querySelector("table")).toBeNull();
  expect(store.mutate).not.toHaveBeenCalled();
});

const jsonPathTool = { ...tool, pluginId: "com.zicode.devtools.compare", capabilityId: "devtools.compare.json.path" };
const jsonPathSchema = {
  type: "object", required: ["text", "query"], additionalProperties: false,
  properties: { text: { type: "string", maxLength: 8192 }, query: { type: "string", maxLength: 4096 } },
};

async function mountJsonPath() {
  const view = await mount(jsonPathTool, undefined, jsonPathSchema);
  const form = within(view.container);
  const picker = form.getByLabelText("JSON 输入文件") as HTMLInputElement;
  const document = view.container.querySelector("form textarea") as HTMLTextAreaElement;
  const query = form.getByRole("textbox", { name: /query/i }) as HTMLTextAreaElement;
  const importFile = async (files: NodeFile[]) => {
    await act(async () => { fireEvent.change(picker, { target: { files } }); });
  };
  return { ...view, form, picker, document, query, importFile };
}

it("imports a JSON document into the query draft without running it and can undo", async () => {
  const { api, form, picker, document, query, importFile } = await mountJsonPath();
  expect(picker.accept).toBe(".json");
  fireEvent.change(document, { target: { value: '{"previous":true}' } });
  fireEvent.change(query, { target: { value: "$.项目[*]" } });
  const text = '{\r\n  "项目": [9223372036854775807]\r\n}';
  await importFile([new NodeFile(["\uFEFF", text], "document.JSON")]);
  expect(document.value).toBe(text.replaceAll("\r\n", "\n"));
  expect(query.value).toBe("$.项目[*]");
  expect(api.invoke).not.toHaveBeenCalled();

  await importFile([]);
  expect(document.value).toBe(text.replaceAll("\r\n", "\n"));
  await act(async () => { form.getByRole("button", { name: "撤销上次导入" }).click(); });
  expect(document.value).toBe('{"previous":true}');
  expect(query.value).toBe("$.项目[*]");
});

it.each([
  ["notes.txt", [new Uint8Array([0x31])], "请选择 JSON 文件。"],
  ["invalid.json", [new Uint8Array([0xff])], "文件必须使用有效的 UTF-8 编码。"],
  ["empty.json", ["  \n"], "所选 JSON 文件为空。"],
  ["large.json", ["中".repeat(2731)], "JSON 文件不能超过 8 KiB。"],
] as const)("rejects %s without replacing the existing JSON query draft", async (name, bytes, message) => {
  const { api, form, document, query, importFile } = await mountJsonPath();
  fireEvent.change(document, { target: { value: "Prior JSON" } });
  fireEvent.change(query, { target: { value: "$.prior" } });
  await importFile([new NodeFile([...bytes], name)]);
  expect(form.getByRole("alert").textContent).toBe(message);
  expect(document.value).toBe("Prior JSON");
  expect(query.value).toBe("$.prior");
  expect(api.invoke).not.toHaveBeenCalled();
});

it("undoes only the imported JSON when the user has edited its independent query", async () => {
  const { api, form, document, query, importFile, submit } = await mountJsonPath();
  const oldDocument = '{"open":9,"closed":15}';
  const selection = new NodeFile(['\uFEFF{"open":1,"closed":2}'], "selected.json");
  fireEvent.change(document, { target: { value: oldDocument } });
  fireEvent.change(query, { target: { value: "$.open" } });
  await importFile([selection]);
  fireEvent.change(query, { target: { value: "$.closed" } });
  await act(async () => { form.getByRole("button", { name: "撤销上次导入" }).click(); });
  expect(document.value).toBe(oldDocument);
  expect(query.value).toBe("$.closed");
  expect(api.invoke).not.toHaveBeenCalled();
  expect(Buffer.from(await selection.arrayBuffer())).toEqual(Buffer.from('\uFEFF{"open":1,"closed":2}'));
  await submit();
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text: oldDocument, query: "$.closed" });
});

it("preserves only the latest JSON import undo and invalidates it on a JSON edit or catalog reload", async () => {
  const { api, form, document, query, importFile, renderScope } = await mountJsonPath();
  const undoLabel = { name: "撤销上次导入" };
  const first = '{"a":1}';
  const second = new NodeFile(['{"b":2}'], "second.json");
  fireEvent.change(document, { target: { value: '{"before":true}' } });
  await importFile([new NodeFile([first], "first.json")]);
  fireEvent.change(query, { target: { value: "$.a" } });
  await importFile([second]);
  fireEvent.change(query, { target: { value: "$.b" } });
  await act(async () => { form.getByRole("button", undoLabel).click(); });
  expect(document.value).toBe(first);
  expect(query.value).toBe("$.b");

  await importFile([second]);
  fireEvent.change(document, { target: { value: '{"edited":true}' } });
  expect(form.queryByRole("button", undoLabel)).toBeNull();
  await importFile([second]);
  fireEvent.change(query, { target: { value: "$.reloaded" } });
  expect(form.getByRole("button", undoLabel)).toBeTruthy();

  await renderScope("workspace", jsonPathTool, "refreshed-revision");
  expect(form.queryByRole("button", undoLabel)).toBeNull();
  const refreshedQuery = form.getByRole("textbox", { name: /query/i });
  fireEvent.change(refreshedQuery, { target: { value: "$.afterReload" } });
  expect(form.queryByRole("button", undoLabel)).toBeNull();
  expect(api.invoke).not.toHaveBeenCalled();
});

it("accepts exactly 8 KiB as the JSON query draft", async () => {
  const { document, importFile } = await mountJsonPath();
  const content = "{}" + " ".repeat(8190);
  await importFile([new NodeFile([content], "limit.json")]);
  expect(document.value).toBe(content);
});

const compareWorker = process.env.ZICODE_TEST_COMPARE_WORKER;
const compareModule = process.env.ZICODE_TEST_COMPARE_MODULE;

function bindFrozenCompareWorker(api: ManualToolApi) {
  vi.mocked(api.invoke).mockImplementation(async (sceneId, _workspaceId, pluginId, capabilityId, input) => {
    const output = spawnSync(compareWorker as string, ["--zicode-plugin-worker"], {
      input: JSON.stringify({ workerPath: compareModule, workerKind: "wasi", pluginId, capabilityId, sceneId, input }),
      windowsHide: true, encoding: "utf8", timeout: 15000,
    });
    expect(output.status).toBe(0);
    return JSON.parse(output.stdout);
  });
}
it.runIf(Boolean(compareWorker && compareModule))("queries a selected JSON file through the frozen Windows Compare Worker", async () => {
  const { api, store, container, document, query, importFile, submit } = await mountJsonPath();
  bindFrozenCompareWorker(api);
  const text = '{"项目":[{"金额":9223372036854775807},{"金额":18446744073709551615}]}';
  const path = '$.项目[*]["金额"]';
  fireEvent.change(query, { target: { value: path } });
  await importFile([new NodeFile([text], "fixture.json")]);
  expect(api.invoke).not.toHaveBeenCalled();
  await submit();
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ text, query: path });
  const result = () => container.querySelector<HTMLTextAreaElement>("[data-tool-result]")?.value;
  expect(result()).toContain("9223372036854775807");
  expect(result()).toContain("18446744073709551615");
  expect(store.mutate).toHaveBeenCalledTimes(1);

  fireEvent.change(query, { target: { value: "$.缺失[*]" } });
  await submit();
  expect(result()).toBe("[]");
  fireEvent.change(query, { target: { value: "$.." } });
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("INVALID_INPUT");
  expect(document.value).toBe(text);

  fireEvent.change(query, { target: { value: path } });
  const invalidJson = '{"项目":';
  await importFile([new NodeFile([invalidJson], "invalid.json")]);
  await submit();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("INVALID_INPUT");
  expect(document.value).toBe(invalidJson);
  expect(store.mutate).toHaveBeenCalledTimes(2);
}, 25_000);

const diffTool = { ...jsonPathTool, capabilityId: "devtools.compare.text.diff" };
const diffSchema = {
  type: "object", required: ["left", "right"], additionalProperties: false,
  properties: { left: { type: "string", maxLength: 8192 }, right: { type: "string", maxLength: 8192 } },
};

async function mountTextDiff() {
  const view = await mount(diffTool, undefined, diffSchema);
  const form = within(view.container);
  const left = form.getByRole<HTMLTextAreaElement>("textbox", { name: /^原文/ });
  const right = form.getByRole<HTMLTextAreaElement>("textbox", { name: /^修改后/ });
  const pick = async (side: "left" | "right", files: NodeFile[]) => {
    const label = side === "left" ? "左侧文本文件" : "右侧文本文件";
    await act(async () => fireEvent.change(form.getByLabelText(label), { target: { files } }));
  };
  return { ...view, form, left, right, pick };
}

it("imports either text file without running and undoes only the last import", async () => {
  const { api, form, left, right, pick } = await mountTextDiff();
  fireEvent.change(left, { target: { value: "prior left" } });
  fireEvent.change(right, { target: { value: "prior right" } });
  await pick("left", [new NodeFile(["\uFEFF", "起先\r\n  尾空格  \r\n"], "before.rs")]);
  expect(left.value).toBe("起先\n  尾空格  \n");
  expect(right.value).toBe("prior right");
  await pick("right", [new NodeFile([], "empty")]);
  expect(left.value).toBe("起先\n  尾空格  \n");
  expect(right.value).toBe("");
  await pick("left", []);
  expect(api.invoke).not.toHaveBeenCalled();
  await act(async () => { form.getByRole("button", { name: "撤销上次导入" }).click(); });
  expect(left.value).toBe("起先\n  尾空格  \n");
  expect(right.value).toBe("prior right");
});

it.each(["left", "right"] as const)("restores only the %s import after editing the other text", async side => {
  const { api, form, left, right, pick, submit } = await mountTextDiff();
  const [imported, other] = side === "left" ? [left, right] : [right, left];
  fireEvent.change(imported, { target: { value: "draft before import" } });
  fireEvent.change(other, { target: { value: "original other draft" } });
  const file = new NodeFile(["导入\r\n文本\r\n"], "fixture.txt");
  await pick(side, [file]);
  fireEvent.change(other, { target: { value: "keep this edit" } });
  await act(async () => { form.getByRole("button", { name: "撤销上次导入" }).click(); });
  expect(imported.value).toBe("draft before import");
  expect(other.value).toBe("keep this edit");
  expect(api.invoke).not.toHaveBeenCalled();
  await submit();
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({
    left: left.value,
    right: right.value,
  });

  await pick(side, [file]);
  fireEvent.change(imported, { target: { value: "edit the imported text itself" } });
  expect(form.queryByRole("button", { name: "撤销上次导入" })).toBeNull();
});

it("accepts exactly 8 KiB, retains both drafts on invalid UTF-8 or one extra byte", async () => {
  const { form, left, right, pick, api } = await mountTextDiff();
  const boundary = "中".repeat(2730) + "aa";
  await pick("left", [new NodeFile([boundary], "before.log")]);
  await pick("right", [new NodeFile([" \t\n"], "after")]);
  expect(left.value).toBe(boundary);
  expect(right.value).toBe(" \t\n");
  await pick("left", [new NodeFile([boundary + "a"], "too-large.txt")]);
  expect(form.getByRole("alert").textContent).toBe("文本文件不能超过 8 KiB。");
  await pick("right", [new NodeFile([new Uint8Array([0xff])], "invalid.txt")]);
  expect(form.getByRole("alert").textContent).toBe("文件必须使用有效的 UTF-8 编码。");
  expect(left.value).toBe(boundary);
  expect(right.value).toBe(" \t\n");
  expect(api.invoke).not.toHaveBeenCalled();
});

it.runIf(Boolean(compareWorker && compareModule))("compares selected text files through the frozen Windows Worker", async () => {
  const { api, container, pick, submit } = await mountTextDiff();
  bindFrozenCompareWorker(api);
  const left = "序言\r\n旧值  \r\n收尾\r\n";
  const right = "序言\r\n新值  \r\n收尾\r\n";
  await pick("left", [new NodeFile(["\uFEFF", left], "before.txt")]);
  await pick("right", [new NodeFile([right], "revised.md")]);
  expect(api.invoke).not.toHaveBeenCalled();
  await submit();
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ left, right });
  const result = () => container.querySelector<HTMLTextAreaElement>("[data-tool-result]")?.value;
  expect(result()).toContain("-旧值  \n+新值  \n");

  await pick("left", [new NodeFile([], "empty.txt")]);
  await submit();
  expect(vi.mocked(api.invoke).mock.calls[1][4]).toEqual({ left: "", right });
  expect(result()).toContain("+新值  \n");
}, 25_000);

const jsonDiffModes = ["ordered", "unordered"] as const;
type JsonDiffMode = typeof jsonDiffModes[number];

async function mountJsonDiff(mode: JsonDiffMode) {
  const view = await mount({ ...jsonPathTool, capabilityId: "devtools.compare.json.diff." + mode }, undefined, diffSchema);
  const form = within(view.container);
  const left = form.getByRole<HTMLTextAreaElement>("textbox", { name: /^原始 JSON/ });
  const right = form.getByRole<HTMLTextAreaElement>("textbox", { name: /^修改后的 JSON/ });
  const pick = async (side: "left" | "right", files: NodeFile[]) => {
    const label = side === "left" ? "左侧 JSON 文件" : "右侧 JSON 文件";
    const picker = form.getByLabelText<HTMLInputElement>(label);
    expect(picker.accept).toBe(".json");
    await act(async () => fireEvent.change(picker, { target: { files } }));
  };
  return { ...view, form, left, right, pick };
}

it.each(jsonDiffModes)("imports either JSON file without running the %s comparison and can undo the last import", async (mode) => {
  const { api, form, left, right, pick } = await mountJsonDiff(mode);
  fireEvent.change(left, { target: { value: '{"original":true}' } });
  fireEvent.change(right, { target: { value: '{"revised":true}' } });
  const original = '{"amount":18446744073709551614}';
  const revised = '{"amount":18446744073709551615}';
  await pick("left", [new NodeFile(["\uFEFF", original], "before.JSON")]);
  expect(left.value).toBe(original);
  expect(right.value).toBe('{"revised":true}');
  await pick("right", [new NodeFile([revised], "after.json")]);
  await pick("left", []);
  expect(left.value).toBe(original);
  expect(right.value).toBe(revised);
  expect(api.invoke).not.toHaveBeenCalled();
  await act(async () => { form.getByRole("button", { name: "撤销上次导入" }).click(); });
  expect(left.value).toBe(original);
  expect(right.value).toBe('{"revised":true}');
});

it("keeps both JSON drafts when the file extension, size or contents cannot be loaded", async () => {
  const { api, form, left, right, pick } = await mountJsonDiff("ordered");
  fireEvent.change(left, { target: { value: '{"original":true}' } });
  fireEvent.change(right, { target: { value: '{"revised":true}' } });
  const cases = [
    [new NodeFile(["{}"], "wrong.txt"), "请选择 JSON 文件。"],
    [new NodeFile([" ".repeat(8191), "{}"], "large.json"), "JSON 文件不能超过 8 KiB。"],
    [new NodeFile([new Uint8Array([0xff])], "bad.json"), "文件必须使用有效的 UTF-8 编码。"],
    [new NodeFile([" \r\n"], "empty.json"), "所选 JSON 文件为空。"],
  ] as const;
  for (const [file, error] of cases) {
    await pick("right", [file]);
    expect(form.getByRole("alert").textContent).toBe(error);
    expect(left.value).toBe('{"original":true}');
    expect(right.value).toBe('{"revised":true}');
  }
  expect(api.invoke).not.toHaveBeenCalled();
});

for (const mode of jsonDiffModes) {
  it.runIf(Boolean(compareWorker && compareModule))("runs the " + mode + " JSON file comparison with the frozen Windows Worker", async () => {
    const { api, pick, submit, container } = await mountJsonDiff(mode);
    bindFrozenCompareWorker(api);
    const left = '{\r\n  "项目/名~":[1,2], "amount":18446744073709551614\r\n}';
    const right = '{"项目/名~":[3,2],"amount":18446744073709551615}';
    await pick("left", [new NodeFile([left], "before.json")]);
    await pick("right", [new NodeFile([right], "after.json")]);
    expect(api.invoke).not.toHaveBeenCalled();
    await submit();
    expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ left, right });
    const result = container.querySelector<HTMLTextAreaElement>("[data-tool-result]")?.value;
    expect(result).toContain('"path": "' + (mode === "ordered" ? "/项目~1名~0/0" : "/项目~1名~0") + '"');
    expect(result).toContain("18446744073709551614");
    expect(result).toContain("18446744073709551615");
  }, 25_000);
}

const mixedMergePlugin = "com.zicode.devtools.table-merge";
const mixedMergePackage = process.env.ZICODE_TEST_TABLE_MERGE_PACKAGE;
const mixedMergeWorker = process.env.ZICODE_TEST_WORKER_EXE;

const mergeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["left", "leftFormat", "right", "rightFormat"],
  properties: {
    left: { type: "string", maxLength: 8192 },
    leftFormat: { type: "string", enum: ["json", "tsv", "csv"] },
    right: { type: "string", maxLength: 8192 },
    rightFormat: { type: "string", enum: ["tsv", "csv", "json"] },
  },
};

async function mountMixedMerge(mode = "append", inputSchema: unknown = mergeSchema) {
  const active = { ...tool, pluginId: mixedMergePlugin, capabilityId: "devtools.table-merge." + mode };
  const fixture = await mount(active, undefined, inputSchema);
  const form = within(fixture.container.querySelector("form") as HTMLFormElement);
  const left = form.getByRole("textbox", { name: /^左表\s*\*?$/ }) as HTMLTextAreaElement;
  const right = form.getByRole("textbox", { name: /^右表\s*\*?$/ }) as HTMLTextAreaElement;
  const leftFormat = form.getByRole("combobox", { name: /左表格式/ }) as HTMLSelectElement;
  const rightFormat = form.getByRole("combobox", { name: /右表格式/ }) as HTMLSelectElement;
  async function choose(side: "left" | "right", files: NodeFile[]) {
    const picker = form.getByLabelText(side === "left" ? "左表文件" : "右表文件", { exact: true });
    await act(async () => { fireEvent.change(picker, { target: { files } }); });
  }
  return { ...fixture, form, left, right, leftFormat, rightFormat, choose };
}

it("changes only the chosen table and its declared format, and undoes the last import", async () => {
  const { api, container, form, left, right, leftFormat, rightFormat, choose } = await mountMixedMerge();
  const csv = "id,label\r\n1,甲";
  const json = '[{"label":"乙","id":18446744073709551615}]';
  await choose("left", [new NodeFile(["\uFEFF", csv], "left.CSV")]);
  expect(left.value).toBe(csv.replaceAll("\r\n", "\n"));
  expect(leftFormat.value).toBe("2");
  await choose("right", [new NodeFile([json], "right.json")]);
  expect(right.value).toBe(json);
  expect(rightFormat.value).toBe("2");

  await choose("left", []);
  expect(leftFormat.value).toBe("2");
  await choose("left", [new NodeFile([new Uint8Array([0xff])], "bad.tsv")]);
  expect(within(container).getByRole("alert").textContent).toContain("UTF-8");
  expect(left.value).toContain("1,甲");
  expect(right.value).toBe(json);
  expect(rightFormat.value).toBe("2");
  await choose("left", [new NodeFile(["中".repeat(2731)], "large.tsv")]);
  expect(within(container).getByRole("alert").textContent).toContain("8 KiB");
  expect(right.value).toBe(json);

  await act(async () => { form.getByRole("button", { name: "撤销上次导入" }).click(); });
  expect(left.value).toContain("1,甲");
  expect(leftFormat.value).toBe("2");
  expect(right.value).toBe("");
  expect(rightFormat.value).toBe("");
  expect(api.invoke).not.toHaveBeenCalled();
});

it.runIf(Boolean(mixedMergePackage && mixedMergeWorker)).each([
  ["append", "csv", "label,amount\n原件,001", "json", '{"headers":["amount","label"],"rows":[[18446744073709551615,"大数"]]}', "18446744073709551615"],
  ["inner", "tsv", "id\tlabel\n1\tL", "csv", "id,team\n1,R", '"R"'],
  ["left", "csv", "id,label\n1,L", "json", '[{"id":1,"amount":0},{"id":"1","amount":18446744073709551615}]', "18446744073709551615"],
  ["columns", "json", '[{"id":9223372036854775807}]', "tsv", "id\tname\n001\t甲", "9223372036854775807"],
])("uses the frozen independent-format plugin through the visible %s form", async (mode, leftFormat, left, rightFormat, right, expected) => {
  const packagePath = mixedMergePackage as string;
  const manifest = JSON.parse(readFileSync(join(packagePath, "plugin.json"), "utf8"));
  const capability = manifest.contributes.capabilities.find((item: {id: string}) => item.id === "devtools.table-merge." + mode);
  const fixture = await mountMixedMerge(mode, capability.inputSchema);
  const { api, choose, submit, container, form } = fixture;
  vi.mocked(api.invoke).mockImplementation(async (sceneId, _workspaceId, pluginId, capabilityId, input) => {
    const worker = spawnSync(mixedMergeWorker as string, ["--zicode-plugin-worker"], {
      input: JSON.stringify({ workerPath: join(packagePath, manifest.runtime.wasi), workerKind: "wasi", pluginId, capabilityId, sceneId, input }),
      windowsHide: true, encoding: "utf8", timeout: 12000,
    });
    expect(worker.status).toBe(0);
    return JSON.parse(worker.stdout);
  });
  await choose("right", [new NodeFile([right], "right." + rightFormat)]);
  await choose("left", [new NodeFile([left], "left." + leftFormat)]);
  const input = { left, right, leftFormat, rightFormat };
  const keyFields = mode === "left" || mode === "inner" ? { leftKey: "id", rightKey: "id" } : {};
  if (mode === "left" || mode === "inner") {
    const leftKey = form.getByRole("textbox", { name: "左表关联列" }) as HTMLTextAreaElement;
    const rightKey = form.getByRole("textbox", { name: "右表关联列" }) as HTMLTextAreaElement;
    expect([leftKey.rows, rightKey.rows]).toEqual([1, 1]);
    await act(async () => {
      fireEvent.change(leftKey, { target: { value: "id" } });
      fireEvent.change(rightKey, { target: { value: "id" } });
    });
  }
  expect(api.invoke).not.toHaveBeenCalled();
  await submit();
  expect(vi.mocked(api.invoke).mock.calls[0][4]).toEqual({ ...input, ...keyFields });
  const result = within(container);
  expect(result.getByRole("table").textContent).toContain(expected);
  const originalFormat = { left: fixture.leftFormat.value, right: fixture.rightFormat.value };
  const editors = { left: fixture.left, right: fixture.right };
  const formats = { left: fixture.leftFormat, right: fixture.rightFormat };
  const originals = { left, right };
  for (const side of ["left", "right"] as const) {
    const opposite = side === "left" ? "right" : "left";
    const label = side === "left" ? "应用结果到左表" : "应用结果到右表";
    const apply = result.getByRole("button", { name: label }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    await act(async () => { apply.click(); });
    expect(editors[side].value).toMatch(/^\{"headers":\[/);
    expect(editors[side].value).toContain(expected);
    expect(formats[side].selectedOptions[0].textContent).toBe("json");
    expect(editors[opposite].value).toBe(originals[opposite]);
    expect(formats[opposite].value).toBe(originalFormat[opposite]);
    expect(api.invoke).toHaveBeenCalledTimes(1);
    expect(fixture.store.mutate).toHaveBeenCalledTimes(1);
    await act(async () => { form.getByRole("button", { name: "撤销上次应用" }).click(); });
    expect([editors.left.value, editors.right.value]).toEqual([left, right]);
    expect([formats.left.value, formats.right.value]).toEqual([originalFormat.left, originalFormat.right]);
  }
  if (mode === "append") {
    await act(async () => { result.getByRole("button", { name: "应用结果到左表" }).click(); });
    const applied = fixture.left.value;
    await submit();
    expect(vi.mocked(api.invoke).mock.calls[1][4]).toEqual({ left: applied, right, leftFormat: "json", rightFormat });
    expect(result.getByRole("table").textContent).toContain("18446744073709551615");
  }
}, 20000);

async function runMergeFixture(output: string) {
  const fixture = await mountMixedMerge();
  vi.mocked(fixture.api.invoke).mockResolvedValue({ result: envelope(output) });
  await fixture.choose("left", [new NodeFile(["id\n1"], "left.csv")]);
  await fixture.choose("right", [new NodeFile(['[{"id":"2"}]'], "right.json")]);
  await fixture.submit();
  return fixture;
}

const fixtureResult = (value: string) => JSON.stringify({
  report: "Merged", data: { headers: ["id"], rows: [[value]] }, csv: "id\n",
});

it("disables an older merge result after an edit and never restores that result on a workspace round trip", async () => {
  const { container, form, renderScope, left, right, api } = await runMergeFixture(fixtureResult("result"));
  const result = within(container);
  const applyLeft = () => result.getByRole("button", { name: "应用结果到左表" }) as HTMLButtonElement;
  expect(applyLeft().disabled).toBe(false);
  await act(async () => { fireEvent.change(left, { target: { value: "new draft" } }); });
  expect(applyLeft().disabled).toBe(true);
  expect(left.value).toBe("new draft");
  expect(right.value).toBe('[{"id":"2"}]');
  expect(form.queryByRole("button", { name: "撤销上次应用" })).toBeNull();
  expect(api.invoke).toHaveBeenCalledTimes(1);
  await renderScope("another-workspace");
  await renderScope("workspace");
  expect(result.queryByRole("button", { name: "应用结果到左表" })).toBeNull();
});

it("retains a later draft edit instead of allowing merge undo to roll it back", async () => {
  const { container, form, left, right } = await runMergeFixture(fixtureResult("result"));
  const result = within(container);
  await act(async () => { result.getByRole("button", { name: "应用结果到右表" }).click(); });
  expect(right.value).toContain("result");
  await act(async () => { fireEvent.change(left, { target: { value: "later edit" } }); });
  expect(form.queryByRole("button", { name: "撤销上次应用" })).toBeNull();
  expect((result.getByRole("button", { name: "应用结果到左表" }) as HTMLButtonElement).disabled).toBe(true);
  expect(left.value).toBe("later edit");
  expect(right.value).toContain("result");
});

it("keeps a result readable when its compact JSON exceeds the per-table byte budget", async () => {
  const { container, left, right } = await runMergeFixture(fixtureResult("中".repeat(2731)));
  const result = within(container);
  expect(result.getByRole("table")).toBeTruthy();
  expect((result.getByRole("button", { name: "应用结果到左表" }) as HTMLButtonElement).disabled).toBe(true);
  expect((result.getByRole("button", { name: "应用结果到右表" }) as HTMLButtonElement).disabled).toBe(true);
  expect(left.value).toBe("id\n1");
  expect(right.value).toBe('[{"id":"2"}]');
});


it("ignores a previous merge execution failure after switching workspace and can run again", async () => {
  const fixture = await mountMixedMerge();
  await fixture.choose("left", [new NodeFile(["id\n1"], "left.csv")]);
  await fixture.choose("right", [new NodeFile(['[{"id":"2"}]'], "right.json")]);
  let rejectPrevious: (reason: Error) => void = () => {};
  const previous = new Promise<never>((_resolve, reject) => { rejectPrevious = reject; });
  vi.mocked(fixture.api.invoke).mockImplementationOnce(() => previous);
  await fixture.submit();
  expect(fixture.api.invoke).toHaveBeenCalledTimes(1);
  await fixture.renderScope("another-workspace");
  await act(async () => { rejectPrevious(new Error("Old workspace failure")); });
  expect(within(fixture.container).queryByRole("alert")).toBeNull();
  expect(fixture.container.querySelector('button[type="submit"]')?.hasAttribute("disabled")).toBe(false);
  vi.mocked(fixture.api.invoke).mockResolvedValueOnce({ result: envelope(fixtureResult("new result")) });
  await fixture.submit();
  expect(vi.mocked(fixture.api.invoke).mock.calls[1][1]).toBe("another-workspace");
  expect(within(fixture.container).getByRole("table").textContent).toContain("new result");
});
