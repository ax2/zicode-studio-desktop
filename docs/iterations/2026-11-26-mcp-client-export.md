# v0.7.9 · MCP 客户端配置预览

在 Studio 插件管理审核启用 0.1.0 后，到工具中心搜索「MCP 配置 · Codex TOML」或「MCP 配置 · 通用 JSON」。填写已知且信任的 ZiDevTools MCP 服务程序 Windows 盘符绝对路径，最多 1024 UTF-8 字节。运行后可复制完整文本，也可预览并确认保存到 Studio 产物。需要客户端配置文件时，将复制的文本另存为相应格式。

这是独立版 `mcp-export` 的两个部分映射。Codex TOML 启用 `list_knowledge_sources` 和 `search_knowledge`，保留 `writes` 审批模式。通用 `mcpServers` JSON 提供字面 `command` 和空 `args`，客户端信任及审批由用户在目标客户端配置。工具使用用户提供的路径文本生成配置。程序存在性和来源由用户核对，独立版保留自动发现和 Codex CLI 命令，客户端注册与程序执行继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `34798bdea329bf980f19525499f5ffc1c61d8b0b` 随 [ZiDevTools #45](https://github.com/ax2/zi-devtools/pull/45) 合入 `064c6bb1ef1b4ab6666b89be243dc3cd1a3ab0c3`。相关源码、构建清单和验证脚本字节一致。真实 Windows Worker 与原生适配器 36 项通过，覆盖中文、空格、单引号、便携版名、1024 字节边界及无效路径；原生既有格式化回归 1 项通过。Worker 回执 SHA-256 `d0f1ecef1371e865e519e9f61bbebbf6f4390864e2163e49e9e1a75f73f4f4b0`。
- 冻结包 8 件、182,853 字节。目录索引 SHA-256 `45fbf2fd5e7137beb1a07c705ce6f96510a8a28997246cd211eef9c895fddab4`，WASM `a09a176f09188a3db75b05244d50d38d718fdb688d8eb3e08bb69c4635c4d856`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/mcp-client-export-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/mcp-client-export-0.1.0-candidate-01-verification.json)
- 复用独立 Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce`，通过真实工具中心、Host 和 Worker，验证两个入口的预览、取消、确认保存、无效 UNC 路径拒绝、重启复算和产物保留。独立读取两份 Studio 产物并用 TOML 和 JSON 解析器核对字面路径、工具名单及审批字段。TOML 内容为 186 字节、JSON 内容为 135 字节，存储格式为 Studio 文本产物。
- 首装、重启及独立读回回执 SHA-256 为 `f0b797ed5d0da3edbc4b346af81332ddbc128c43440d03b9f5c104a3a82ded62`、`d903925fbe9280288cbc4cd3e3a72eb353ad74b3028de46526db82385b9e11ad` 和 `be40de44c28c0b63f6995d824398d6016000f4fbab817f668f0677eb645c0bd2`。
