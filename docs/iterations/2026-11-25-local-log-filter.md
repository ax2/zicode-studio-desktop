# v0.7.9 · 本机日志筛选

在插件管理中审核并启用独立日志工具后，从工具中心搜索「本机日志筛选」。选择一份 UTF-8 日志并确认提供该文件，按需填写级别及区分大小写的字面搜索词，再执行。插件用已有的 resource.read 和 resource.wasi.input.draft2 读取当次快照。

文件上限 16 KiB，搜索词上限 256 个 UTF-8 字节。报告给出事件总数、匹配总数及前 12 条，每条预览最多 512 字节，报告和单项预览分别标注截断。支持开头的 UTF-8 BOM、CRLF、缩进及常见堆栈续行。

## Windows 验收

- 提供方源码 71ae71fdd4506a52dfe816104cae53d1b7b13e16，合入 e63716cb266bc525d7405c657987616ecde4c9c4。独立版日志查看器 9 项测试通过，公开 Level 入口与原数值保留。[提供方 PR](https://github.com/ax2/zi-devtools/pull/9)
- 冻结候选 02 共 8 文件、208,016 字节，目录 SHA-256 94efb4ed2c451d8cef04fdd81f38469dc5af156c8c9b3eedf2039c5879b5941b，WASM SHA-256 55f7f6f3dd81edd32eb87960c6a4af212d56fd89703f5f876e9877b705ffed58。生产 Worker 16 项通过。早期密集短行耗尽燃料，修正分类后在原有 10M fuel、5 秒及 64 MiB 内通过。[候选目录](../../tests/fixtures/devtools-windows-file-tools/log-viewer-0.1.0-candidate-02) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/log-viewer-0.1.0-candidate-02-verification.json)
- 实际 Windows Studio 在专用隔离资料中授权、启用及打开工具。合成日志含 5 个事件，级别 error 和「连接超时」精确匹配第 2 个事件的 3 行。确认前不能执行，撤销会清除结果并停用执行，无效 UTF-8 正确拒绝。安装后的 8 个文件一致。回执 SHA-256 f5483118ffc3f4a9181e6a0892fb1109903cd251524ef2393a87ae2859255c47。

原生文件对话框、大日志流式索引、分页及轮转继续跟踪。[#29](https://github.com/ax2/zicode-studio-desktop/issues/29)
