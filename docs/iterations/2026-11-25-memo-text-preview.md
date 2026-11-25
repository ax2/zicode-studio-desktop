# v0.7.9 · 备忘导入预览

在插件管理审核并启用 ZiDevTools `com.zicode.devtools.memo-text` 0.1.0。在工具中心搜索「备忘导入预览」，选取并确认共享一份 Markdown 或 UTF-8 文本，再点击执行。标题最多 120 字，留空时使用「导入的备忘」。

工具校验整个文件，正文上限 128 KiB，允许开头另有 3 字节 UTF-8 BOM。错误编码和空字节会提示原因。正文最多显示前 6 KiB，按 UTF-8 字符边界截取，并显示已显示和全文字节数。换行、空格、制表符和 Markdown 标记可按原样复制。原件保持原样。

## Windows 验收

- 冻结候选共 8 件、163,561 字节。目录索引 SHA-256 `f8c4f1db9ee89b241184fb8d506e3b877f2d8db9cdbc765e1da00b79e6bee3cf`，WASM SHA-256 `879da94702f5aded106a4dce035587d746ce79ab3b09752245f7069530772f23`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/memo-text-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/memo-text-0.1.0-candidate-01-verification.json)
- 提供方源码 `5a3d6389f2ac47c95b856e6d24f20b8aa5a3b8af`。Windows Worker 和独立版结果对照通过 28 项。独立版日程和备忘回归通过 110 项。覆盖 128 KiB 和 BOM、显示范围之后的无效编码和空字节、以及多字节字符截取。 [ZiDevTools PR #27](https://github.com/ax2/zi-devtools/pull/27)

- Windows Studio 0.7.4 隔离资料中的真实工具中心、Host 和 Worker 通过 6 个场景。确认前无法执行。正文正好 128 KiB 加 BOM 时显示第一个 6 KiB，超出一个字节、摘录之后的坏 UTF-8 及 NUL 均能识别。空正文、指定标题、CRLF、制表和尾部空格对照通过。撤权清掉结果，重启后同包保持启用，重新确认可得到同样的报告。源文件摘要保持。安装与重启回执 SHA-256 `4728fb5c9e41a15d4b010fdd38b0aaa980f96728286359f7430018215733ac8e` 和 `77512eea25510bca39a1bdf77677e2526ec453f2db9132af2ac1c59b6d56c70f`。

本次覆盖 `memo-library` 的单文件只读预览。Windows 系统选包及正式安装版留待集中验收。批量导入提交、标签、导出、知识接力和跨机资料库同步继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
