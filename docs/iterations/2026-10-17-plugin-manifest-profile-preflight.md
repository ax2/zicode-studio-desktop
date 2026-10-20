# Stage：插件 manifest profile 声明预检（2026-10-17）

## 目标与发现

Studio 接收 ZiDevTools 候选时，收据校验只能证明目录文件与提供方收据相符。
冻结的 URL 文本资源 candidate-02 文件校验通过，但 Host 安装首先拒绝缺少
`tool.directory.v1` 声明；该候选还缺少 `output.schema.v1` 声明。
逐次修一条安装错误会增加双方交接轮次。

## 修改

- 新增只读 `scripts/check-plugin-manifest-profiles.mjs` 和
  `bun run check:plugin-manifest-profiles -- <plugin.json>` 命令，按能力汇总
  `directory`、`fileInput`、`resourceInputMimeTypes`、`outputSchema`、
  `maxResultBytes` 所需 profile 的缺项。
- 后续补充能力级 `executionProfile` 声明检查；图片缩放 profile 还提示缺少
  `resource.output.types.v1`。它只提示缺项，不验证版本或运行时预算。
- 在 DevTools 交付规范中记录用法和边界。脚本不写 manifest 或冻结候选。

## 验证

- 对冻结 candidate-02 运行命令，退出码 1；一次列出
  `devtools.transforms.url.encode` 缺少 `tool.directory.v1` 与
  `output.schema.v1` 两项。收据通过与此声明失败是不同检查。
- 两项定向 Vitest 测试通过：候选缺项和声明齐全情形。
- `bun run check` 通过；既有警告/提示仍在。只涉及 JS 和文档，未触发 Rust 构建。
- 本轮前后存储扫描的 `target` 和 `task-scratch` 无变化；没有清理缓存或
  再试此前被策略拒绝的删除。

## 遗留与验收边界

预检只判断已出现字段是否有同名 profile 键，不验证声明版本、schemaVersion、
manifest 完整性、签名、收据、权限、Worker 执行或 UI 流程。退出码 0 不代表
Host 已接受。提供方须交付修正后的新候选与收据，Studio 再做 Host 安装及完整
“发现→加载→执行→展示结果”验收；ZiDevTools 全目录接受仍为 0/154。

## 2026-10-17 能力执行协议补充

预检现对能力 `executionProfile` 检查同名 `requiredProfiles` 声明；使用
`resource.wasi.image.resize.v1` 时，还提示缺少 `resource.output.types.v1`。
这是提供方构包前的声明缺项提示，不批准未知 profile，也不替代 Host 的
版本、权限、WASI 和预算校验。

定向 Vitest 3/3 通过，`bun run check` 退出 0（已有 lint/design 提示）。
冻结 URL candidate-02 再查仍准确列出原两项缺失，未改候选。
前后只读存储扫描 `target` 同为 29,399,678,867 B，task-scratch 同为
838,287,896 B；没有删除或新建运行目录。

## 2026-10-17 多包预检补充

预检现在可接收最多 256 个显式 manifest 路径，逐包报告缺项或读取错误；
重复路径只查一次，单包调用维持原有 JSON 形状。新增定向用例覆盖多包
结果与重复路径，定向 Vitest 5/5、`bun run check` 均通过。对两个冻结
候选试跑，URL 文本候选仍报原两项缺失，Agent 辅助候选报 0 项；预检
进程按缺项返回 1，符合约定。

只读扫描 DevTools 当前 `plugins/` 的 8 份 manifest：3 项声明提示，
其中 URL 文本资源候选缺 `tool.directory.v1` 和 `output.schema.v1`，
Diagnostics 声明 `output.schema.v1` 但当前能力无输出契约字段；没有读取
或改写提供方包之外的文件。此汇总不核验版本、签名、完整操作覆盖或 Host
接纳，全部工具完整接受数仍为 0/154。此前被审批拒绝的清理没有重试。
前后只读预算中 `target` 均为 29,909,581,893 B、task-scratch 均为
939,353,231 B，未知项均为 0；卷可用量受其他进程影响，不按差额计算收益。
