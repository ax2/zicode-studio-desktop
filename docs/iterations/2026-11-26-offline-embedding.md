# v0.7.9 · 离线向量比较

从仓库获取[冻结目录](../../tests/fixtures/devtools-windows-file-tools/embedding-files-0.1.0-candidate-02)和[同级逐件收据](../../tests/fixtures/devtools-windows-file-tools/embedding-files-0.1.0-candidate-02-verification.json)，按[插件获取与核验说明](../plugins/devtools-public-delivery.md#只取一个包)核对。在插件管理安装并审核授予 `resource.read`，然后从工具中心搜索「离线向量比较」。

确认共享两份从 ZiDevTools 复制并分别保存的 JSON 数值数组。显示的文件顺序对应 A/B。也可以共享一份含恰好两个 `embeddings` 的已有响应。结果只显示维度、两份范数、余弦相似度和欧氏距离。撤销当前共享会清空结果，再次比较需要重新确认。源文件保持完整，模型名称和向量原值不出现在结果中。该入口使用已有向量进行离线比较，嵌入生成与服务连接仍由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。

两个向量须等维、非零，分量须为绝对值不超过 1,000,000 的有限数。每文件最多 256 KiB，向量最多 8192 维。已验证 8192 维整数和 4096 维长小数。去掉 JSON 外围空白后的字节加每个小数或指数标记 24 字节，工作量合计不超过 352 KiB。小数或指数标记最多 10,000 个，逗号最多 16,416 个。额外的响应字段也计入工作量。

## Windows 验收

- 提供方 [ZiDevTools #57](https://github.com/ax2/zi-devtools/pull/57) 合入 `a0b9044d57082f4842a33d059e07b9826ad0292b`。候选 02 冻结源码 `0b5001c8c8c599a8789d3ff2becfbfd634edf26c`，8 件、250,479 B。目录索引 `7abbbe98440395e72032d0db7cbb3c2cf4691adb1ee60cb6e34727f33c404da7`，逐件收据 `b7dd67fb245a85970320b85c4425d0d13d8108698c84a4da9687cc6fb0b39b5e`，WASM `2fe71885d5925a6b9795a0ea8a7f8765a436c88fcd70292bcd03a024e4c2f244`。
- Windows Worker 57 项通过，原生嵌入回归 1 项、两个新增目标的原生与 WASI 严格检查通过。固定用例可读结果逐字一致，结构化小数按绝对及相对容差 `2e-14` 核对。原发生的密集小数燃料和外围空白失败保留。最终使用原 Worker 限额。
- Windows Studio 0.7.4 Debug `235431bc2c949148ed8ab731f03953385e1ef0ce` 隔离资料首装 8 项、重启 2 项。实际确认反序与单响应。两文件反序执行后 A/B 范数为 2/5。覆盖共享前取消、撤回后清空、等维/非零与大小边界，原 SHA-256 不变。首装及重启回执 `2af8145b902291c84d9e4c88f8cac04155784735356b2fc3bf4f38e37f401054`、`84c8469567a3c50d3df274e0c4b660db3f8ad35498aff9bbc4f87fcec32caa87`。系统文件选择窗口保留集中验收。
