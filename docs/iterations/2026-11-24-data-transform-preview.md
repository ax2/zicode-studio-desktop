# Windows Studio 数据列变换预览

在「工具」内打开数据列变换操作，粘贴 CSV、TSV 或 JSON 及对应的选项后执行。结果顶部显示变换后的表格、变化数量和分页。原有的完整结果、可复制的 CSV 字段和原始响应在下方。需要排查数据时，错误会指出第一条失败的数据行和列名，数据行编号从表头之后的第一条记录开始。

当前只读取 `com.zicode.devtools.compute` 下的数据列变换结果。Worker 返回的原始数字用于展示 64 位整数和嵌套值。长列名和结构化值用纯文本显示，表格自身滚动。预览保留输入文本和参数，失败时不产生可保存的部分转换结果。当前 Worker 请求/结果和文本字节限制保持既有配置。

## 验收范围

- 两项 Windows Worker 能力通过 6 个真实 Host 输入，覆盖有符号 64 位整数两端、夹在有效记录间的失败行、只有表头、长中文列名、重复表头和含无符号 64 位最大值的嵌套数据。随后用这 6 个真实响应验证 React 显示。
- 工具中心、结果动作和矩阵共 207 项前端回归通过，TypeScript、双语、设计检查和严格 MkDocs 通过。窄窗下的视觉检查随版本集中验收。
- 覆盖整表翻页、表头无数据行、长列名和重复列名、嵌套值、长整数、部分行失败、原响应可读和原始输入不变。
- Host 验证使用含独立收据的 Compute 0.2.0 候选 01 和生产 Windows Worker，运行 `data_transform_preview_frozen_host_results`。该测试输出以 `DATA_TRANSFORM_RESPONSE` 开头的合成回执，将完整输出文件设为 `ZICODE_TEST_DATA_TRANSFORM_RESPONSES` 可把它作为 React 工具页验收输入。
- 显式应用、单步撤销、大输入、文件导入/保存和完整原生工作流仍归 [#28](https://github.com/ax2/zicode-studio-desktop/issues/28)。当前日常安装清点和完整源工具计数继续沿用原记录。
