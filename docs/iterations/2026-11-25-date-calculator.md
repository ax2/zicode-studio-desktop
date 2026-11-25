# v0.7.9 · 日期与工作日

在插件管理启用 `com.zicode.devtools.date-calculator` 0.1.0。到工具中心搜索「日期差」「日期加减」「工作日计数」或「工作日加减」。四项工具共用独立版日期算法，无需授予权限。

| 操作 | 输入和结果 |
| --- | --- |
| 日期差 | 输入开始日和结束日，返回带符号的日期差。 |
| 日期加减 | 输入日期、整数偏移量和单位。按天、月或年计算。目标月份没有相同日期时，可明确选择截到月末。 |
| 工作日计数 | 按周一至周五计数，包含结束日，可选择包含开始日。结束日早于开始日时提示错误。 |
| 工作日加减 | 正向或反向跳过周末，零偏移保留输入日期。 |

日期格式为 YYYY-MM-DD，公历范围 0001–9999 年，偏移量绝对值最多 4,000,000。工作日规则只计周一至周五，节假日和调休不参与计算。每次请求最多 4 KiB，结果最多 2 KiB。页面直接显示天数或日期和星期，原始响应保留对应的结构化字段。

## Windows 验收

- Windows 隔离 Studio 从四个正常工具中心入口执行八次。实际 Host 和生产 Worker 核对闰年、全公历区间反向日期差、月末严格拒绝和截断、端点包含、反向跨周末及 2,608,614 个工作日的正向偏移。插件所需和实际获授权限均为空。Studio 回执 SHA-256 `26a740ed959ac23aa6680bcfe10d564ca28eea0715deb724834c000f0dedc4a9`。
- 31 项 Windows 生产 Worker 与原生适配器对照通过，包括全区间工作日计数及正反向工作日偏移，原生日期模块 5 项通过。区间计数仍使用原常数级规则，偏移沿用二分；工程预算保持原值。Worker 回执 SHA-256 `570b290e546ab020654f8ab5f0a773cc9a4ce01e1d0f4b35b1eaee47d4ba9bc4`。
- 提供方已验收源码 `5abfc8e78cdee8c1cd576614d4fd04e7c2fe56e9`。候选 01 共 8 个文件、228,830 字节，目录 SHA-256 `feaaced436fef48116083eb4ae4801b7c4e8670c961d8bdd7a67c1d7f8c15498`，WASM SHA-256 `e8064564816b8d3498fc92fbb4d86510850117533dac053c86a71db3f917f6da`。[冻结目录](../../tests/fixtures/devtools-windows-file-tools/date-calculator-0.1.0-candidate-01) · [逐件校验清单](../../tests/fixtures/devtools-windows-file-tools/date-calculator-0.1.0-candidate-01-verification.json)

源工具 `advanced-calculator` 的表达式、矩阵、求根、工作表和日程接力继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。
