# Deno 工作区目录发现工作日志（2026-10-01）

## 目标与资料

普通子项目扫描限四层目录；此前 Deno 根配置的 `workspace` 成员声明没有进入额外目录发现，深层成员可能遗漏。Deno 官方 [Workspaces 文档](https://docs.deno.com/runtime/fundamentals/workspaces/) 使用 `workspace` 路径数组，并示例 `packages/**` 模式；成员可以使用 `deno.json` 或 `package.json`。

## 修改与决策

- 根目录按 Deno 优先顺序读取 `deno.json`、`deno.jsonc`，复用与任务目录相同的有界 JSONC 解析；只处理 `workspace` 路径数组。无效配置使目录发现标记不完整。
- 成员路径复用现有工作区 glob 语法、步数、深度、成员数量和目录链接边界。声明目录需有既有受支持清单或 Deno 配置；此要求不改变 JS/pnpm 工作区成员的原有判定。
- 只补充目录选择，不推断依赖关系，也不把根目录 Deno 任务自动继承到成员。用户仍可手动输入工作区内目录。

## 验证与遗留

`bun run check:rust:static` 通过（Cargo check 与 Clippy），本轮 Rust 文件的独立格式检查通过；全仓库格式检查仍提示其他文件的既有格式漂移。检查后执行 `cargo clean`，清理约 3.3 GiB 再生构建缓存。本轮未运行测试或真实 Deno 命令。其他 Deno 工作区配置形态、真实跨平台文件系统和深层成员操作待实机验收。
