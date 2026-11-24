# 数据列变换导入本地表格

在列变换的输入区选择「导入表格文件…」，可打开单个 CSV、TSV 或 JSON 文件。导入后检查输入和列设置，再按「执行工具」。文件后缀决定输入格式，已有列名、替换值和保留列继续使用，原文件保持原样。需要恢复导入前的草稿时，选择「撤销上次导入」。

文件大小与 Compute 冻结合同一致，为 8 KiB，编码需为有效 UTF-8。导入支持 UTF-8 BOM，读取时移除 BOM。导入和手工输入共用同一 Worker 运行预算。损坏文件、读取失败、超限、空文件和已有选项不合法时，草稿保持原样。

## Windows 验收

- 使用生产 Worker 和冻结 Compute 0.1.0 候选 02、0.2.0 候选 01。两版分别通过 React 的选文件事件、CSV/TSV/JSON 执行、精确的有符号 64 位整数、再次执行和草稿撤销。
- 回归验证了 8192 字节通过、8193 字节拒绝、BOM、CRLF、无效 UTF-8、错误后缀、导入不执行、切换工作区时过期结果不写入。物理 Windows 选择窗口留待集中桌面操作。
- 重放使用 ZICODE_TEST_TRANSFORM_WORKER、ZICODE_TEST_TRANSFORM_MODULE 指定 Windows Worker 与固定候选 WASM，然后运行 ManualToolTransformApply.test.tsx。

此回执对应 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28)。较大输入和其他工具继续按各自范围验收。
