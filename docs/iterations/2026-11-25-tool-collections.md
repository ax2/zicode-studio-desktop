# v0.7.9 · 工具集合导入预览

在插件管理审核并启用 ZiDevTools `com.zicode.devtools.tool-collections` 0.1.0。在工具中心打开「工具集合导入预览」，选择并确认共享一份最多 128 KiB 的 ZiDevTools 版本 1 JSON 导出。工具检查集合名称、重复项、成员格式和版本，保留原集合与成员顺序。未知工具 ID 仍显示为文本。

在「比较名称」填入一个字符串 JSON 数组，可模拟导入与现有名称的冲突。结果按已有独立版规则建议「（导入 n）」名称。集合和比较名称合计最多 128 项，单组最多 512 个工具 ID，每项最多 512 字节。

「起始集合序号」从 1 开始，每回最多显示 16 组。填写「工具起始序号」可在首个所列集合中继续查看成员，结果提供下一页序号。每页最多 16 个完整的 ID，字符串转义较多时本页数量会减少。预览校验完整文件，接收方工具当前是否可用由其目录决定。

## Windows 验收

- 冻结候选共 8 件、287,825 字节。目录索引 SHA-256 `facca391903d76035f1b9b0f34650f1e47c32e30f394be008e219f2d7c3d3ec1`，WASM SHA-256 `b0632ec5e62ea5667e6f7fd44ded72fda45497ea68521346e4d9a542a525ad0e`。[候选目录](../../tests/fixtures/devtools-windows-file-tools/tool-collections-0.1.0-candidate-01) · [逐件收据](../../tests/fixtures/devtools-windows-file-tools/tool-collections-0.1.0-candidate-01-verification.json)
- 提供方源码 `e4aea7b3263b7489063e2dcbaba453ced8daaf57`。真实 Windows Worker 47 项和独立版偏好回归 12 项通过，覆盖 128 KiB、128 组、单组 512 项、重名、Unicode 和分页边界。 [ZiDevTools PR #30](https://github.com/ax2/zi-devtools/pull/30)

- Windows Studio 0.7.4 的真实工具中心、Host 和 Worker 通过 9 项首次执行。恰好 128 KiB 的文件在同一次授权中读到成员 1–16、17–32 和末项 512。空集合、越界、版本或大小超限，以及 512 字节需转义的单条 ID 也通过对照。重名数据返回「Dev（导入 3）」。未确认时不能执行，撤权时清空结果，原件摘要保持。重启后再次确认得到相同首屏。首次自动化定位错误修正后重验通过，冻结包未变化。安装及重启回执 SHA-256 `2b5a3dee7987fd0e7bf718ca6afec202302ac01d8c477c2defca2b6a5a824fc1` 和 `0b004b3f1771bd4266957b4909be7032912d1163bb9e0499badcdc39750456ec`。

本次覆盖 `command-collections` 的导入预览。Windows 系统选包和正式安装仍待集中验收。集合持久化、应用到快捷面板和跨机工作区迁移继续由 [#29](https://github.com/ax2/zicode-studio-desktop/issues/29) 跟踪。独立版的 1 MiB 导入事务保持原范围。
