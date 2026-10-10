# 项目存储候选目录扩展（2026-10-01）

## 目标与发现

项目存储视图已覆盖 Rust、Node 与部分通用产物，但 Python 检查缓存、现代前端框架产物和 .NET 中间目录没有进入列表。开发者需要在同一工作区视图中核对这些常见占用。

## 修改与决策

- Host 固定候选清单增加 `coverage`、`.pytest_cache`、`.mypy_cache`、`.ruff_cache`、`.tox`、`.svelte-kit`、`.nuxt`、`.output` 和 `obj`。仍仅扫描已注册工作区或已验证子项目中的现存目录；总条目、深度和时间预算不变。
- `.tox` 沿用 Python 环境的重建核对提示；Python 检查缓存沿用缓存提示。覆盖率与框架产物使用通用产物提示，不把目录名当成删除许可。
- 中英文帮助及平台推进记录同步目录范围。页面仍只读，不执行清理。

## 验证与遗留

`bun run typecheck`、`bun run check`、`bun run build:react`、新 Rust 模块的 `rustfmt --check` 与 `bun run check:rust:static` 均通过。仓库检查仍报告既有非阻断警告；Rust 脚本的全仓库格式检查仍报告 advisory 漂移。固定候选数现为 21，低于前端的 32 条响应上限。静态检查后运行 `cargo clean --manifest-path src-tauri/Cargo.toml`，Cargo 报告移除 18945 个文件、约 3.3 GiB，仓库根目录 `target` 已消失。本轮不新增或运行测试。三平台真实项目目录、文件权限、扫描预算与界面仍待实机验收。
