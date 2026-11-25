# v0.7.9 · 检索评测报告复核

在插件管理审核并启用 ZiDevTools `com.zicode.devtools.retrieval-review` 0.1.0。打开工具中心的「检索评测报告复核」，选取并确认共享一份 ZiDevTools 导出的 JSON。每份最多 64 KiB、10 题，Top K 支持 3、5 和 8。

仅检索报告 v2 按证据顺序复核首次命中预期文件的名次，并按全部已完成题计算 MRR。双路报告 v1 按文件已记录的两路名次复算命中和 MRR，任一路失败时将该题排除出配对统计。报告提前取消时只统计已完成题。输出用序号标出差异，并省略问题、检索词、原文件路径、模型名称和错误原文。

## Windows 验收

- 冻结候选共 8 件、355,090 字节。目录索引 SHA-256 `05af2f6927fb01daf8b011f52762888f7fcdfe1a2bc553db6527f8d5d3b57876`，WASM SHA-256 `dd66c2d6098f541f038ce374bdbc63ebef73a23af156623024c94768b838db8d`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/retrieval-review-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/retrieval-review-0.1.0-candidate-01-verification.json)
- 提供方源码 `34411932d0f521a5ae106fb77410a92440fa7e57`。Windows 真实 Worker 47 项通过。使用独立版实际生成的单路报告复核，并覆盖双路配对、输入边界、部分完成、过期排名与脱敏。 [ZiDevTools PR #32](https://github.com/ax2/zi-devtools/pull/32)
- Windows Studio 0.7.4 的正常工具中心、Host 与生产 Worker 通过首次 7 项和重启 1 项。复核单路、双路、错排名和计数，拒绝模型报告、超一个字节及坏结构。逐次确认后才执行，撤权清空并禁用，原文件摘要保持。重启再次确认后报告一致。安装及重启回执 SHA-256 `db046b4504672741dfb16249673877816043f4d07277cd4190b85e2951f78265` 和 `82948f86bea62cbdfb74fd7bfac556572dd65ff4f97095ed4dc928ab28430210`。

本次覆盖 `rag-eval` 的离线报告复核，本机索引、数据集编辑和模型评测继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。正式安装和系统选包留待集中验收。
