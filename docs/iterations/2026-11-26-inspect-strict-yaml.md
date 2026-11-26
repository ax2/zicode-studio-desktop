# v0.7.9 · Inspect YAML 与 JSON 文件转换

在插件管理确认启用 Inspect 0.1.4 后，在工具中心打开「YAML → JSON」或「JSON → YAML」。导入本机 YAML、YML 或 JSON 后显式执行，成功后可下载完整文件。转换要求映射键唯一，数字必须能精确写出。无法精确转换时保留输入并显示当前界面语言的提示，原文件不会被覆盖。可以精确写出的 64 位有符号和无符号整数仍保留。

单次输入最多 8 KiB，结果仍受 48 KiB 约束。同一 Windows Worker 的三条极密集 YAML 输入在新旧版均耗尽现有执行预算，工具会报错。独立版保留原有行为；Inspect 0.1.2 的文件入口和原冻结包继续可用。

## 本机验收

- 提供方 [PR #46](https://github.com/ax2/zi-devtools/pull/46) 从 `802b350651ce26547fead4e34dda4546e364e29d` 合入 `f1cb63f437a44a925787610d23fa43f053788dee`。冻结来源 `c53968ea1074088f75df91967202ee6ec6f1c8fe`。真实 Windows Worker 在八个能力中验证 141 个样例，138 通过，其余为前述三个既有预算场景。10 个满 8192 字节的边界样例中 7 个完整转换。没有提高现有预算。
- 最终候选 619 件、2,456,328 字节。目录索引 SHA-256 `ad2349420097697c2b4c14fab5c1a0a97eb67382e87fcbf4569fa0d8f57c7d9e`，收据 `f2a80333aa6fc2a12296558f40af2b140577a32ef4621df77d3045166dbc5c16`，WASM `87eac509ffefdd8f4ba45a226afff3ecc24934618fc12b59bf2b03574448087f`。[候选包](../../tests/fixtures/devtools-inspect-strict-yaml/inspect-0.1.4-candidate-02) · [逐件收据](../../tests/fixtures/devtools-inspect-strict-yaml/inspect-0.1.4-candidate-02-verification.json)
- 真实 Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce` 使用独立资料和本分支生产工具中心、词典资源。候选实际安装、核对启用，双向均用正常工具中心读本机 BOM/CRLF 文件、成功生成输出或拒绝重复键。重启后仍启用，两个输出 SHA-256 与首装一致。启动和重启证据 `02f084d68b8d1ef0357020a75c5ad5d425f511862124ef5b00e65a8c36a731d9`、`d4565a1d3c22a2dd40545532f7c7bf40b98eb4895a8648bf9c6c317c9df526ce`。
- 宽英文和窄中文的生产页面连接实际 Worker，用与最终冻结包相同的 WASM 及相同 YAML 清单字段验证 24 次运行。完整下载 8 份，文件字节与 Worker 输出一致；高精度小数、下溢、重复键和语法错误共 16 次拒绝，没有下载，原件字节不变。窗口测试回执 `5119b484c7b02c59c8aff1ca4721827a9f586dba69522d27af635b66b83fd442`。工具中心与翻译 345 项通过，24 项原有未启用；两代 Inspect 均通过全部 8 个 View 定位，定位没有触发工具执行。
