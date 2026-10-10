# Deno 版本诊断工作日志（2026-10-01）

## 目标与发现

Deno 配置和任务已接入，但环境页未将 Deno 配置对应的 CLI 放在项目工具组，`.tool-versions` 与 mise 的 `deno` 声明也只显示原文，未利用已有 CLI 探测结果。

## 修改与决策

- Deno 清单关联 Deno CLI，使项目工具组直接呈现其版本、路径和探测状态。
- Windows Deno CLI 探测使用与项目命令一致的管理器查找规则，兼容有效 PATH 中的 `.exe`、`.cmd` 和 `.bat` 包装器；调用参数仍固定为 `--version`。
- 对版本管理器声明的单一完整数字版本比较本次 Deno CLI 输出的首行。只接受 `deno 主.次.补丁` 及可选括号元数据；其他输出显示无法解析。不推断 asdf/mise 实际解析与选用顺序。

## 验证与遗留

`bun run check`、`bun run typecheck`、`bun run build:react`、`bun run check:rust:static` 和本轮文件的定向格式检查通过。全仓库 Rust 格式检查仍提示其他文件的既有格式漂移；前端 lint 保留仓库既有警告。检查后执行 `cargo clean`，清理约 3.3 GiB 再生构建缓存。未运行测试或真实 Deno 命令。Windows、macOS、Linux 的真实 Deno 安装与版本管理器选择待实机验收。
