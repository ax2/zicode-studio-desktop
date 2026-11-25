# v0.7.9 · ICS 日程预览

在插件管理审核并启用 `com.zicode.devtools.ics-preview` 0.1.0。进入工具中心，搜索「ICS 日程预览」，选择一份本机 UTF-8 ICS 2.0，确认共享后点击执行。

文件上限 16 KiB，按原顺序预览最多 8 条日程，文字累计上限 6 KiB。预览保留全天、浮动、UTC 或命名时区的原始开始与结束值。重复规则显示 RRULE 原文及例外提示，日程不会展开。源文件保持原样。

## Windows 验收

- 真实 Studio Host 和生产 WASI Worker 处理一份 637 字节合成日历，读回四种时间类型及一条重复规则。执行前确认，撤权后清空，无效日期拒绝，源文件摘要一致。原生文件对话框保留集中验收。Studio 回执 SHA-256 `e66263bdf8726e73bb0cc24fd662a1013ed177a8c60dd987021d634ec889b10a`。
- 提供方源码 `afe6b2058a6bd9df8501cfc156bf976eba088115`。真实 Worker 对照原生适配器 17 项，独立日历解析 14 项通过。Worker 回执 SHA-256 `6ee0ae1419d3bed3529bb45a33657b36485ee8259c9125ee4ccbf47b56a99523`。
- 冻结候选共 8 件、288,918 字节。目录摘要 `c626dd8b3382228ebb2b4cad01397cb5c8a3f66cbf2ee11969affddec08b3d0a`，WASM 摘要 `da4242bd7f0116ccc54d080d3147c914ca90bd43cc9c079a9cde29b4527dbd20`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/ics-preview-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/ics-preview-0.1.0-candidate-01-verification.json)

`calendar-planner` 的编辑、同步、导出、重复展开和时区换算继续在 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
