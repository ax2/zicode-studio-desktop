# uv 工作区成员识别（2026-09-30）

## 目标与发现

前一轮只识别当前目录的 `uv.lock` 或 `[tool.uv]`。uv monorepo 的锁文件常位于根目录，成员的 `pyproject.toml` 可以没有 `[tool.uv]`，所以选中成员子目录时缺少 uv 命令。已有项目发现器能有界展开 JS、Cargo 和 pnpm 工作区声明，可沿用同一套路径匹配与目录限制。

## 修改与决策

- 根 `pyproject.toml` 的 `[tool.uv.workspace]` `members` 和 `exclude` 加入声明目录发现。语法与既有相对路径、通配符、链接边界和预算一致；无效声明标记目录发现不完整，普通扫描仍继续。
- 选中子目录时，只有有效本地 `pyproject.toml` 且被根 uv 成员声明匹配、未被排除，才继承根 uv 工作区能力；不因根目录单独存在 `uv.lock` 就把任意嵌套 Python 项目当作成员。
- 成员目录的 uv 同步命令识别根 `uv.lock`，存在时使用 `uv sync --locked`。任务指纹包含根声明内容、成员状态及适用锁文件有无；根声明或锁状态改变时旧清单不能直接启动。
- 更新中英文项目帮助和环境提示。普通目录发现仍可能列出被 uv `exclude` 排除的独立项目，但不授予其继承的 uv 命令。

## 验证与遗留

`bun run typecheck`、`bun run check`、`bun run build:react`、`bun run check:rust:static`、修改模块的 `rustfmt --check` 与相关文件的 `git diff --check` 均通过。Rust 静态入口的格式步骤提示仓库其他文件存在漂移，不影响其退出码；项目检查仍有 123 条警告、7 条提示与一条设计警告，退出码为 0。随后 `cargo clean` 清理本轮 3.2 GiB 编译产物。本轮不运行测试、真实 uv 命令或跨平台实机验收。成员身份只按当前支持的有界模式判断，不解析 uv 的完整工作区语义、动态依赖或外部路径。
