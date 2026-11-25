# v0.7.9 · 提示词模板工具

在插件管理审核并启用 ZiDevTools `com.zicode.devtools.prompt-expansion` 0.1.0。在工具中心打开「提示词变量检查」查看去重、排序后的变量名。用「提示词模板展开」时，填写模板和仅含字符串值的 JSON 对象，例如 `{"project":"桌面应用"}`。

`{{project}}` 使用 `project` 的值。写成 `{{{{project}}}}` 时保留字面 `{{project}}`。变量名以英文字母或下划线开头，最长 32 字。展开只替换模板已有的变量，插入值按原样保留。缺值或纯空白值会提示填写。

模板正文上限 16 KiB 和 12 个不同变量，序列化请求及响应各 48 KiB。完整展开上限 128 KiB。初始预览上限 16 KiB，JSON 转义较多时会自动缩短。结果显示已显示和完整正文的字节数，并在截取时提示。两个入口均离线执行，无需模型或文件权限。

## Windows 验收

- 冻结候选共 8 件、262,626 字节。目录索引 SHA-256 `e90d804c8087bb5b8c6fc4fbd08d483eb3196c4079f92b89c1f6c864e33052b5`，WASM SHA-256 `e6ae602db3ae39fc47ad3a05849a4b8822d0f1c6aeb673c5c99e0dc1b2e39f06`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/prompt-expansion-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/prompt-expansion-0.1.0-candidate-01-verification.json)
- 提供方源码 `2071bf2807e30c78c7e7042024bc877353822f84`。最终 Windows Worker 43 项通过。首次 8 个密集边界超预算，收据保留。单遍查找消除反复扫描，继续使用现有 10M fuel。与旧版对照的 271,453 个短组合在变量、展开和错误文本上完全一致，独立版模板和资料库 6 项通过。 [ZiDevTools PR #28](https://github.com/ax2/zi-devtools/pull/28)

- Windows Studio 0.7.4 的真实工具中心、Host 和 Worker 使用同一个冻结包，无额外授权。首次通过 7 项，覆盖变量排序去重、单次展开、四括号字面、缺值或无效输入、16 KiB 密集模板，以及 128 KiB 展开时的 16 KiB 截取提示。重启后两个入口重新执行并得到相同摘要。首次重启自动化错误地比较了省略值，修正验证脚本后复验通过，包与程序字节一致。安装与重启回执 SHA-256 `1100bdd1f1b18af05fa07d2338e4a7b6356f7beb68884fdf0e8ecbfc8ff254d2` 和 `1f85b08a7d47459ecff81d6c49da7b20dd1d1a244a6fe9b8e0be6c707cf6fc43`。

本次覆盖 `prompt-library` 的离线变量检查和展开。保存命名模板、修订、标签、向其他工具传递正文和模型工作流继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
