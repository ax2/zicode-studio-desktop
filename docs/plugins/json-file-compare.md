# JSON 文件查询与对比

跟踪 [GitHub #28](https://github.com/ax2/zicode-studio-desktop/issues/28)。这批入口使用独立包 `com.zicode.devtools.compare-json-file`，沿用已安装的文本查询与对比工具。

| 工具 | 输入 | 结果 |
| --- | --- | --- |
| JSON 文件路径查询 | 一个 UTF-8 JSON 文件及最多 4096 字节的 JSONPath | JSON 匹配数组。支持字段、带引号字段、数组索引和通配符，最多 128 步和 10,000 项匹配。 |
| JSON 文件对比（数组按顺序） | 左、右两个 UTF-8 JSON 文件 | 结构化变化和 JSON Pointer 路径，按数组下标比较。 |
| JSON 文件对比（数组忽略顺序） | 左、右两个 UTF-8 JSON 文件 | 结构化变化和 JSON Pointer 路径，递归比较无序数组并保留重复项数量。 |

每个文件最多 1 MiB，输出最多 8 MiB，对比最多 10,000 项变化。用户先选择并确认共享，再运行。工具接收当前会话、当前操作的资源快照。可在 Studio 预览完整结果。需要输出文件时，另行确认保存；输出为独立的 `.json`，源文件保持原样。路径过滤器、递归查询、数组切片和对比时忽略路径不在独立工具现有范围内。

## 插件配置

- `resource.wasi.json-file-compare.v1` 精确声明预览版本 `=1.0.0-preview.1`，只接受上述三个资源操作。资源输入使用 `resource.wasi.input.draft2`，输出使用 `resource.wasi.output.draft1`。
- Worker 在这三个操作中用 WASI MIME 索引 28 写入一项 `application/json`。通用插件沿用原有 MIME 范围。Host 校验 JSON 结构、原输入顺序和字节数后生成资源摘要。其他插件读取此结果仍须使用既有的确认流程。
- Worker 的内存上限 64 MiB，燃料上限 40 亿，Host 调用时限 10 秒。结果和待上传资源共用 Studio 既有资源预算。
- 独立候选 `compare-json-file-0.1.0-candidate-02`，目录 SHA-256 `690377f74a0f117702dec9cb759a91117e8777b31d304b1551f4d441e9b18dc0`。候选在隔离开发环境验证，正式安装包和历史发布保持独立。
