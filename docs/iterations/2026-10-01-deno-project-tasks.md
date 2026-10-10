# Deno 项目命令工作日志（2026-10-01）

## 目标与发现

项目命令已有 JavaScript、Rust、Go、Python 等入口，但 `deno.json` 和 `deno.jsonc` 尚不能让目录出现在子项目列表，也没有 Deno CLI 诊断或命令。Deno 配置文件可作为明确的项目依据；JSONC 与自定义 `tasks` 的解析范围更大，本阶段先提供固定命令。

## 修改与决策

- 将有 `deno.json` 或 `deno.jsonc` 的目录纳入有界子项目扫描；项目清单视图标记文件存在。
- 命令目录为此类目录生成 `deno fmt --check`、`deno lint` 和 `deno test`。沿用现有清单读取边界和大小限制，并将配置文件名及内容纳入任务指纹。命令只在用户主动点击后运行。
- 环境页只读探测 `deno --version`。运行时仍由现有工具目录与有效 PATH 规则选取 CLI，不自动安装。
- 不解析配置中的自定义 `tasks`；同时存在两种配置文件时，固定命令只显示一组，来源标注两者。

## 验证与遗留

`bun run check:rust:static` 通过（Cargo check 与 Clippy）；本轮 Rust 文件独立格式检查通过，全仓库格式检查提示已有其他文件的格式漂移。检查后执行 `cargo clean`，清理约 3.3 GiB Rust 构建缓存。本轮未运行测试或真实 Deno 命令。Windows、macOS、Linux 的 Deno 项目实机运行和 JSONC 自定义任务支持待后续处理。
