# 插件输入声明安装门槛（2026-10-17）

## 目标与发现

Zi DevTools 全目录包含不同结构的输入。Studio Host 原先会对未知 `type`、
`pattern`、`format`、组合 schema 等声明不执行对应校验，也不在安装时拒绝。
长度、数量和数值界限的部分错误值同样可能被忽略。提供方无法据此判断
哪些约束在真正执行前生效。

## 修改

- 对 `inputSchema` 根和递归 `properties`/`items` 子声明做支持子集检查：
  拒绝未知关键字、类型及非对象子声明。
- 检查 `required` 项为不重复字符串、`additionalProperties` 为布尔，
  各长度/数量上限与下限为非负整数且顺序一致，数值界限为数字且顺序一致。
- 保留已有 `enum`/`const` 语义，以及 `$schema`、`$id`、title、description、
  default 注解；不从 enum/const 字面值内递归解释 schema。
- 同步互操作说明。内置插件从 17 增至 19 后，注册表旧测试的固定计数
  仍为 17/11；核对当前图片与文本接收器后改为 19/13。

## 验证

- `bun run check:rust:static`：Cargo check 与严格 Clippy 通过，整仓 fmt
  仍报告既有排版漂移；本次新改文件单独由 rustfmt 整理。
- 首次 Rust 测试因本任务此前启动的隔离 Debug 进程占用 EXE 而未运行；
  精确核对进程路径和隔离 profile 参数后，仅关闭 PID 58116，
  用户安装版 PID 3632 未操作。
- 首次过滤词采用文件名，实际运行 0 项，不算通过。
- `cargo test --bin zicode-studio-desktop schema_constraints::tests -- --test-threads=2`：
  6/6 通过，覆盖原有约束及新负例。
- 注册表专项首次 13/14，唯一失败为上述固定数量旧断言；修正后同组 14/14 通过。
- 安装路径回归还验证：带未支持 `pattern` 的开发插件被拒绝，移除该字段后
  同一候选可安装；此项包含在上述 6/6 内。
- 后置只读空间扫描完整、未知项 0：target 29,448,272,490 逻辑字节，
  task-scratch 939,345,906 逻辑字节，E 盘可用 31,035,363,328 字节。
  没有按预算门槛删除有用缓存；卷余量会受其他进程影响。

## 边界

这不是完整 JSON Schema Draft 2020-12 引擎。`pattern`、`format`、
`$ref`、组合 schema 等需要新的 Host 能力及契约测试；不能把提供方的
完整 schema 能力算作已接入。没有改动 DevTools、安装无签名候选、构建
新发布版或改动应用版本。DevTools 154 项完整接受数仍为 0，ZiFile
108 个操作单元也未因本轮改变。无界面改动，因此没有新截图。
