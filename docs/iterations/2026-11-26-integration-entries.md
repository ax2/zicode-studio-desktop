# v0.7.9 · 本机工具目录盘点

在插件管理中审核并启用本机工具目录盘点 0.1.0。在工具中心搜索「本机工具目录盘点」，切换到「文件夹」，选择并确认工作区中的一个目录。工具按 ZiDevTools 集成检查的 Windows 白名单识别 13 组入口名称，例如 Java、Node.js、Codex CLI 和 Git。结果会列出匹配的普通文件名及未找到的工具。可预览全文，再确认保存为新的 UTF-8 文本报告。

每次只共享所选目录的一层名称和类型，最多 128 KiB、2048 项。已知入口名比较忽略 ASCII 大小写，同名目录、相似名称及下层文件不计。只显示白名单匹配项。工具使用现有的 `resource.read`、`resource.directory.read` 权限。系统 PATH 发现、文件内容、程序运行状态、端口和登录状态留在独立版工具范围。完整 Studio 接入继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `5be1366f3b07dc69202633e925b1e9f395778d8f`，随提供方 [PR #40](https://github.com/ax2/zi-devtools/pull/40) 合入。真实 Windows Worker 与原生适配器 24 项对照通过。2048 项包含密集相似入口以及同时达到 128 KiB 的 UTF-8 边界。超限主动返回可读错误，原 Worker 执行预算保持。早期 4096 项密集样本的燃料失败保留。最终 Worker 回执 SHA-256 为 `fbb60163ca41b2e7b2329be509acc9ff14740cad7b9c94d440fe1f96b3bdbb97`。
- 冻结包 8 件，共 188,821 字节。目录索引 SHA-256 为 `cd96407efe58e321e4e77c9dd6c360f0ea4caf9419e93de936372bbf8d61e4a6`，WASM 为 `8b813f9af8dd16b27e07d023792a3d5cf7d9093e6c50adf549f2b7f2e56cfa08`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/integration-entries-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/integration-entries-0.1.0-candidate-01-verification.json)
- 隔离 Windows Studio 使用实际工具中心、Host 枚举和生产 Worker。确认两项权限及单次目录共享后识别 6 组入口。系统选取采用固定合成回执。取消另存没有创建文件，确认后保存 378 字节，撤权后清除结果并停用执行。重启保存件与原生预期逐字节一致，独立检查复核全 13 组结果和 11 个合成源文件摘要。系统原生选择窗口留集中验收。
- 首装、重启回执 SHA-256 分别为 `1c85907fb4d293ddaf5b351ae6806ba9622c99705cf35c01cfdff7afa24694ba` 和 `39f81d2f3423f30a6d89917dbafaf54911738822fa1ca0526c4676f05e87da63`。
