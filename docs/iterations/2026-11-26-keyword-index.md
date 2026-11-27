# v0.7.9 · 本机知识索引关键词检索

在 Studio 插件管理审核启用 0.1.0 后，从工具中心打开「本机知识索引关键词检索」。确认共享一份独立版 ZiDevTools v1 静态 SQLite 知识索引，填入关键词并手动运行。支持自动、字面短语、全部词和任一词，可填写来源 ID 筛选。自动模式遇到 CJK 表意文字时走字面检索，词项模式沿用原生 FTS5 BM25 排序。可预览匹配片段、文本引用及索引记录的摘要，并确认另存 TXT。

从 Studio 源码仓库取得下方链接的完整候选目录和同级收据，按[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)核对原始字节。到插件管理选择「安装本地插件」，打开包含 `plugin.json` 的候选目录，审核并启用 `resource.read`，再到工具中心搜索该工具。

接受 4 KiB 页、UTF-8、自含的 v1 SQLite 静态副本。每份最多 128 KiB、32 个片段、正文合计 4 KiB，每次 1–10 项。查询最多 120 字符、512 字节，字面模式最多 12 个词；FTS5 最多 4 个词项，正文 UTF-8 字节数乘查询词项数最多 12,288。结果中的路径是文本引用。实时索引、打开原文、同步、向量和模型继续按原生范围由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `0839d0daece855570c3706b86853714d57b8806f` 随 [ZiDevTools #47](https://github.com/ax2/zi-devtools/pull/47) 合入 `e95b822d36cbe06f7fb99613a2bfe58708496072`。真实 Windows Worker 与原生适配器 43 项通过，验证 BM25 排序、CJK 字面、失配的 docsize 和倒排、各组合边界及三路并发。原生知识回归 24 项通过、1 条既有忽略，授权器定向 1 项通过。Worker 回执 SHA-256 `530810a2bf4b287360c233a259d433a4b3fbd46916caef11ed050e5d8e88c388`。
- 校验固定 12 个 SQLite v1 架构对象、六个普通表页、docsize 与外部内容一致性。只在一次性内存副本开放固定的 FTS 校验，随后恢复仅查询模式并核对序列化字节与原件一致。保留历史密集输入 fuel 失败，Worker 限额沿用现有值。
- 冻结包 8 件、1,225,055 字节。目录索引 SHA-256 `0ae6f84555898c84e0f154e2d6a6f61e507dcbed58ab4d0c67d8cf326bb609fa`，WASM `4994a96cd134a140fcda44b8f87e0c07772a980b9332c6aaac5b7e31b727ad94`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/keyword-index-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/keyword-index-0.1.0-candidate-01-verification.json)
- 复用隔离 Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce`，通过实际工具中心、Host 和 Worker 验证授权与取消、英文排序、中文检索、失配索引拒绝、撤权和重启。独立读回 842 字节严格 UTF-8 TXT，BM25 对照确认 `z-short.txt` 在 `a-long.txt` 之前，原件摘要保持。系统原生选择窗口和任意位置另存继续集中验收。
- 首装、重启及独立读回回执 SHA-256 为 `3113bbdd429b81f620b26199381de2fd5e820dedd5e2fa5bc31d96e25e51e717`、`7507cd17ca0de96e48679aeb127116de3bccc497ded1013210de24d614a3cbe6` 和 `32e912da564f688f87d6620eea56fbf960f08ca480debee3950ec73feb3bf234`。
