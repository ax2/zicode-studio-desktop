# 2026-09-27 Node 版本文件诊断

状态：本轮实现与静态检查完成；跨平台实机验收待办。

## 目标与决策

- 项目环境页此前只读取 `package.json` 的 Node `engines`，没有显示 `.nvmrc` 与 `.node-version`。这些文件在不同系统和版本管理器上很常见，但文件本身不证明当前 shell 已切换版本。
- 只读取当前选中目录的文件，沿用 manifest 的路径边界、大小和 UTF-8 检查；第一条非空、非注释行是唯一声明，多条声明判为无效。不执行版本管理器。
- 两份文件声明相同则分别展示，声明不同则标为冲突，不推断优先级。比较时容许数字版本前的 `v` 和别名大小写差异。数字声明走现有 npm semver 比较；`node`、`lts/*` 等动态别名只提示人工确认。
- 此诊断不修改命令运行器的 Node 选择，也不切换 PATH；实机版本管理器行为与跨平台验收仍待补。

## 工作记录

- Native manifest 报告接入 `.nvmrc` 和 `.node-version`，复用已有目录边界、256 KiB 大小和 UTF-8 限制；读取单一声明并区分无效文件与声明冲突。
- 前端按现有 Node 版本诊断比较数字声明，对动态别名给出需要版本管理器解析的提示；环境页新增 Node 冲突说明和中英文文案。
- 中英文帮助、平台计划和导航已同步；本轮未修改 Node 命令解析、PATH 或版本管理器配置。

## 验证记录

- `bun run typecheck`：通过。
- `bun run check`：通过；现有 111 条 warning、7 条 info，以及生成终端包的内联高度提示。
- `bun scripts/check-i18n-coverage.mjs`：通过；2532 个键，缺失 0。
- `bun run build:react`：通过；构建后恢复原本干净的生成包。
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets`：通过。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`：通过。
- `uv run --with-requirements requirements-docs.txt python -m mkdocs build --strict`：通过；未列入导航的旧页面提示仍存在。
- 本轮未新增或运行测试；未做真实版本管理器或 macOS/Linux 图形界面验收。

## 遗留与发布

- `lts/*` 等动态别名只能提示人工确认；文件不证明当前终端或项目命令已使用该 Node 版本。还需处理 Node 工具链选择、版本管理器生命周期和跨系统运行验收。
- 本轮保留本地代码、构建产物和文档记录；未提交、推送或发布。
