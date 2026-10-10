# Release 产物目录工作日志（2026-10-01）

## 目标与发现

手动 macOS DMG 入口已考虑 Cargo 在仓库根或 `src-tauri` 下生成 `target`，并处理显式 `CARGO_TARGET_DIR`、`CARGO_BUILD_TARGET`。Release workflow 的上传后核验脚本仍固定查找仓库根 `target/release/bundle`；若实际产物位于另一有效目录，核验会误报缺失。

## 修改与决策

- 核验脚本按 Cargo 环境变量构造目标目录；默认检查仓库根与 `src-tauri/target`，显式相对目录同时检查两个基准，绝对目录只检查该目录。
- 显式 Cargo 构建目标进入 `release/bundle` 之前的路径。候选路径去重；每种产物跨所有候选目录必须恰好一份，避免选中旧文件或含糊的双份结果。
- 仍以本地文件大小和 SHA-256 与草稿 Release 资产核对；未改变发布清单或自动发布条件。

## 验证与遗留

`node --check scripts/verify-release-artifacts.mjs` 与目标文件 Biome lint 退出 0；已按 Biome 格式化。没有运行测试或实际 Release；三平台 Tauri 输出目录及远端草稿资产仍待真实运行验证。
