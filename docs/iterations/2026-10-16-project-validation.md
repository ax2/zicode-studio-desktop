# 现有工作树全量回归与存储复核（2026-10-16）

## 范围

核验当前 Studio 工作树已有的插件、Host、项目、存储和平台集成改动；保留所有既有未提交改动，不构建正式 release。

## 验证

- 前置/后置 `scripts/storage-budget.ps1` 均完整，`UnknownEntries=0`；前后 `target` 均为 29,370,851,882 B / 73,788 文件，`.cache` 均为 310,353,261 B / 155 文件，任务 scratch 均为 748,164,366 B / 29,979 文件。E 盘可用空间由 63,527,989,248 B 变为 63,521,800,192 B；该差值受其他进程影响，不能单独归因于测试。
- `bun run check` 退出 0，Biome lint 与 design 检查完成；Biome 报告 144 条 warning、10 条 info，未自动改写代码。design CSS 检查通过，仍报告 1 条既有 inline-style warning。
- `bun run check:rust:static` 通过：全目标 Cargo check、warnings-as-errors Clippy 通过；cargo fmt advisory 检测到格式漂移，未整体重排文件。
- 第一次 `bun run test` 为 292/293 个文件、2067/2068 项通过，唯一失败是 i18n 覆盖漏译 `Plugin`。增加 `Plugin: 插件` 后完整重跑通过：293/293 个文件、2068/2068 项；后续 Tauri 48 命令权限、Windows 子进程策略与 3370 项中文词条检查均通过。
- `git diff --check` 通过。未运行 Tauri GUI 构建、签名插件包或真实桌面截图验收。

## 结果与限制

本轮修复静态中文覆盖遗漏，并为当前大量未提交工作树提供全量前端与 Rust 静态验证证据。验证通过不代表 DevTools 全量工具或其他平台原生运行验收：DevTools 矩阵仍为 0/154；环境诊断 profile 仍只是需求草案。Debug/Release 缓存保持不变，没有执行清理。

## 11:36–11:44 revalidation after the later plugin changes

- `bun run check` exited 0. Biome completed without modifying files; it reported 144 existing warnings and 10 infos. CSS design checks passed with one existing inline-style warning.
- `bun run check:rust:static` exited 0. All-target `cargo check` and warnings-as-errors Clippy passed. `cargo fmt --check` remains advisory and reported formatting drift; files were not mass-formatted.
- First full `bun run test` run exposed one missing Chinese translation for the Host image-resource input error (`This image is invalid or exceeds the receiver's format or size limits.`); other 2068 assertions passed. Added its zh-CN dictionary entry in `public/i18n.js`.
- Full rerun exited 0: 293/293 files and 2069/2069 tests passed; Tauri permission checks accepted all 48 commands, Windows subprocess policy passed, and all 3371 zh-CN keys were present.
- Validation is Windows-local. No desktop GUI build, rendered screenshot, signed package, or macOS/Linux runtime acceptance was performed. Debug/Release outputs and Cargo caches were not cleaned.