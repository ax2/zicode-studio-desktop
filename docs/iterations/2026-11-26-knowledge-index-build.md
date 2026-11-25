# v0.7.9 · 从文本创建静态知识索引

在 Studio 插件管理选择「安装本地插件」，打开[冻结候选目录](../../tests/fixtures/devtools-windows-file-tools/knowledge-index-build-0.1.0-candidate-01)，审核并启用 `resource.read`。从源码仓库取得完整目录和[同级逐件收据](../../tests/fixtures/devtools-windows-file-tools/knowledge-index-build-0.1.0-candidate-01-verification.json)，按[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)校验原始字节。

在工具中心搜索「从文本创建静态知识索引」，确认共享一份 UTF-8 TXT，再填入 `.txt` 引用名并运行。结果预览显示片段数、正文大小和源 SHA-256。通过「预览保存」和「确认保存文件」创建新的 Studio 产物 `result.sqlite`。根据保存回执找到产物，切换到[本机知识索引关键词检索](2026-11-26-keyword-index.md)，单独确认共享该 SQLite 后即可查询。

每次只处理一份 TXT，含可选 BOM 共计最多 4 KiB。最多生成 32 个片段，含分块重叠的正文合计最多 4 KiB，超限时给出错误。引用名最多 128 UTF-8 字节，用于索引展示。索引便于离线转交和重现检索，采用固定来源标识 `studio-snapshot`，保留原 TXT，并生成独立的 v1 SQLite 文件。多文件和目录索引、增量更新、原生知识库导入、其他格式与模型继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `fe3c2be02e68d23562bc47f066ce32f8f25d4d75` 随 [ZiDevTools #48](https://github.com/ax2/zi-devtools/pull/48) 合入 `ca07b4b02c047aaa4ce4e3cdabec14a2c9be8f0c`。复用独立版 TXT 分段、原生分块、事务写入和 FTS5 架构。原生索引回归 6 项通过、1 项既有 OCR 忽略，原生导入 10 项通过、3 项既有 OCR 或桌面忽略。
- 真实 Windows Worker 通过 27 个生成用例和 6 个冻结搜索 Worker 跟进用例。同一合成源精确达到 4,096 字节，分块正文合计 4,096 字节、32 个片段，英文 BM25 依次返回片段 5、1，中文字面返回片段 6。保留既有 Worker 限额。回执 SHA-256 `cfe066073040a2f1135c8dbefa9366d92b1b086baef8950c8c6182974286bc32`。
- 冻结包 8 件、1,137,711 字节。目录索引 SHA-256 `82ee175cd9075b55e3cd05b79e51ef9055de86f6758c1a115484c9097aa2ffe8`，WASM `416aee9a487f12759ede732c67990c7c15f052e139640f4a2b8cc9ce8779d756`，逐件收据 `25ec94a465ae24a99cf6072400c88183b397af92811a018b42981a8ab4601245`。
- 复用隔离 Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce`。工具中心通过两份包的独立授权、取消共享、取消保存后无文件、确认保存新产物、无效 UTF-8 无可保存结果、撤权及重启。重启后从同一份 45,056 字节的产物复验英文排序和中文字面，独立 SQLite 只读核对 `integrity_check=ok`。产物 SHA-256 `8f8b1a81a1b9f807ad797e0a3e0e94311be116819d30f71a695a03dc9b812e57`，与直接 Worker 结果一致。原 TXT 摘要保持。自动化使用实际应用的表单和合成文件，系统选择窗口与任意位置另存交集中验证。
- 首装、重启和独立读回回执 SHA-256 依次为 `15fb5eca4a7bd57cc9da2104e62f566b78241d0ffc2b83d690c9353799007cbc`、`0545b8a8c9f3c0bb8a6aba5626bc8bbb84f38b4de650a92e69b0d90be6ad3ecb` 和 `63cdca52489a5394126d0c2797a0eacb138b7d3413e37c208745df917090cda7`。
