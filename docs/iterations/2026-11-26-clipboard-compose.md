# v0.7.9 · 剪贴片段组合

在插件管理审核并启用剪贴片段组合 0.1.0，在工具中心搜索「剪贴片段组合」并确认一份本机 UTF-8 JSON。输入可以是字符串数组，或 ZiDevTools 超级剪贴板另存的有序记录。选择段落 TXT、编号 TXT、单列 CSV 或 Markdown 清单，执行后预览全文并确认保存。

工具按数组顺序处理，保留重复与原生换行规则。有序记录要求 `order` 从 1 开始连续递增，只提取 `text`。CSV 保留原生引号和潜在公式前缀的单引号处理。一次限 32 KiB、1–64 段非空文本，完整输出限 48 KiB。使用现有 `resource.read` 与结果确认保存。系统剪贴板采集、实时历史、富文本与模板继续在 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

## Windows 验收

- 提供方源码 `3a05f960467b5704ac49dd07b9b0c5e74bd6326e` 随 [ZiDevTools #42](https://github.com/ax2/zi-devtools/pull/42) 合入。25 项真实 Windows Worker 与原生对照通过，涵盖四种格式、结构化记录、重复、换行、CSV 保护和上下限。独立版 History 21 项通过。Worker 回执 SHA-256 `89e1671abbaeca837924d5ec8c870fc918b6bd7b63a086e95f2701bcb47edb14`。
- 冻结包 8 件，共 216,808 字节。目录索引 SHA-256 `3f0bf642714da2927b47d0c6be15a5b4c0544587b02f0bb2d7f932bd672b994f`，WASM `71f1c7e7a9875f40fe9ff8a62df2a6fb26db082b9f4e1614d9d83d601db9ad43`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/clipboard-compose-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/clipboard-compose-0.1.0-candidate-01-verification.json)
- 隔离 Windows Studio 验证真实工具中心、Host 和 Worker。可预览全部四种输出，取消保存没有落盘，明确确认后各生成一份结果。四个持久文件分别为 76、91、85、87 字节，重启后与原生适配器逐字节一致。独立复核确认七段正文、重复项、CSV 前缀和来源元数据排除。坏顺序拒绝，撤权清除结果，合成 JSON 摘要一致。系统选取和自选保存路径继续集中验收。
- 首装、重启与独立读回回执 SHA-256 为 `acf3b1bac529952eb7bbb9e64ada370a6b1bed54f507d4c5da5c502524274905`、`d4935d5c16e253c3350258ed6a80d9cb61a3b7f143d3d7987d2e95c4ea009567` 和 `3b6c094f875ccdb81c728534a1fdd54cef1e1806af50190f60b23cff64e36066`。
