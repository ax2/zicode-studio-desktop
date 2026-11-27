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

## 精确 JSON 对比 0.1.1

内联 Compare 和独立文件 Compare 使用相同的精确十进制比较。两种数组模式都可区分相邻高精度小数、超出 u64 的整数和通常浮点范围以外的合法指数。变化报告的 before 和 after 保留数字原文，整型、小数与负零的比较规则沿用已有行为。JSON 路径查询与独立程序沿用各自策略。

候选和逐文件验证收据位于 [devtools-compare-precise](../../tests/fixtures/devtools-compare-precise/)。在插件管理中分别核对并安装两个 0.1.1 目录，启用后从工具中心搜索「JSON 对比」或「JSON 文件对比」。文件入口每次需逐份确认源文件，保存完整报告需另行确认。

| 候选 | 包文件数 | 目录索引 SHA-256 |
| --- | ---: | --- |
| compare-0.1.1-candidate-01 | 10 | dd1397be4c0c43b17bf051fa169a946ae0aa9b192a2c7ddefdfedab7135871ce |
| compare-json-file-0.1.1-candidate-01 | 7 | 6db0de22e03b1502d5269094c0657c09aef1b0c3d85d96fb7812c5dff291c805 |

两个候选按提供方验收提交 [650c3110](https://github.com/ax2/zi-devtools/pull/49) 冻结。提供方主线提交 [6f9fa1cf](https://github.com/ax2/zi-devtools/commit/6f9fa1cfe91b887bd01275aa9f10419265c70fb0) 的完整源码树相同。内联 Worker SHA-256 为 `9a9580787e6bb37fec29ba889622d08e41bc032be8b599d43f11e24174ffe886`，文件版为 `ad138672238333ee4a94c2cdfa60d292b660ce5cc20d1a575321de49669e0d26`。

Windows Worker 验证内联 32 项。真实 Host 确认保存内联报告 12 次，另核对 2 个坏输入未生成结果。双文件入口完成 14 组逐个授权、完整预览与逐字节保存，涵盖每份恰好 1 MiB 和原件摘要不变。现有文件路径查询、拒绝确认无写入、坏输入和大小边界也通过。两个 Windows 回执 SHA-256 分别为 `8c8982a4c45a62058a63e86c171ffeae8fd416d08ad11523c6d6ccdd98abbda4` 与 `c4d94262c3e8db65315239e9f91c707ce9982e8d8fdb9ee9837615ccbe4c02c2`。系统原生文件选择和另存窗口保留在集中桌面验收中。[验收记录](https://github.com/ax2/zicode-studio-desktop/issues/28#issuecomment-7175594669)
