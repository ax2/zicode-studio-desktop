# v0.7.9 · 会话文件转 Markdown

在 Studio 插件管理选择「安装本地插件」，打开[完整冻结候选](../../tests/fixtures/devtools-windows-file-tools/conversation-markdown-0.1.0-candidate-01)，审核并启用 `resource.read`。从源码仓库取得候选和[同级逐件收据](../../tests/fixtures/devtools-windows-file-tools/conversation-markdown-0.1.0-candidate-01-verification.json)，按[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)核对原始字节。

在工具中心搜索「会话文件转 Markdown」。选择一份 ZiDevTools 独立版导出的 UTF-8 会话 JSON，确认共享并手动运行。查看问答轮数和输出字节后，通过「预览保存」和「确认保存文件」创建新的 `result.md`。原 JSON 保持完整。

`model-chat` 的这一离线导出入口接受 `zi-devtools-conversation` 版本 1，按原顺序保留 1–16 轮完整问答。正文使用比原文反引号更长的纯文本围栏，代码、HTML、Markdown 标记和链接均以文字保留。输入上限 64 KiB（含可选 BOM），JSON 转义上限 12,288 个，Markdown 输出上限 192 KiB。未知字段、系统/工具消息和不完整问答会给出错误。实时对话、模型配置、附件内容和会话库恢复继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `93191a00f3bb512b5d72e15654070a0d15cc6977` 随 [ZiDevTools #51](https://github.com/ax2/zi-devtools/pull/51) 合入 `d177ff256bf020d22429d9964a3adc9f5250debd`。复用独立版严格解析和纯文本围栏。原生会话 3 项、会话库 3 项及定向严格检查通过。
- 实际 Windows Worker 通过 35 个固定用例，覆盖完整 16 轮、64 KiB 普通和中文文本、最大反引号围栏、四类密集转义、转义上限加一、代理对、未知字段及摘要变更。保留最密集转义的早期 fuel 失败。最终候选在原 Worker 限额下提示超限。Worker 回执 SHA-256 `fbb66aafa88b36ca5d9311d602d7d2465194cd08deb8da19e96cb42e20c38d7d`。
- 冻结包 8 件、268,233 字节。目录索引 SHA-256 `18fc2af80116e3354ec017e6b48e4ab5ce424a2f939882e53ee994c2f71f585e`，WASM `e8b8bce967c3f240671a13e93a9db157d6393bb3f8b793e56606f280cd3cf376`，逐件收据 `d8bb5cd4ead04beecab9e1139813dc8ccfef2d2e264d697de09b89ff58e20fce`。
- 隔离 Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce` 实测工具中心的分享与取消、错误无产物、取消保存、两个明确保存、撤权和重启。接受一份普通双轮会话，以及一个精确 65,536 字节的合成原件。产物分别 399 和 196,356 字节。独立逐条读回确认全部内容处于对应纯文本围栏，保存结果与 Worker 摘要相同，两份原件摘要保持。系统原生选择窗口与任意位置另存留集中验收。
- 首装、重启和独立读回回执 SHA-256 依次为 `6c3eb89cea4033184ccb766c342f151028fad839b438cfa5400cfcf81207bd0b`、`0183760ba10bc0a5c5fe1ee3d109ffa71b7c49ff1e010cd09748d22dc4f53a53` 和 `0e4901e17ae8043f9e7ebc9e84dcb4949ab4bc64a6bb216e934452cb6cc1c364`。
