# v0.6.0 工具入口集成记录（第一批）

此记录关联 Project #4 的 #30 / #34，均为 P1 / v0.6.0。它不是发行完成声明。

## 源码与隔离

在原有干净发布工作树 `.worktrees/release-0510` 中，从已发布 v0.5.11 的 `cf05be8093e6eb355786c899ef54ce832a7fdfd3` 建立 `integration/v0.6.0`。复用工作树、依赖及唯一主 Cargo target，不新建完整仓库/运行时副本。`release/v0.5.11`、既有标签与日常开发工作树不变；集成中暂保留 0.5.11 元数据，正式选择发行候选时再统一升版。

第一批显式复制 23 个文件，包含启动器、搜索/分类/分页、收藏与最近、翻译导航、管理页刷新保留状态、托盘翻译排序、Host 收藏顺序及对应测试。未整仓暂存，也未把其他会话未完成的实现当作已验收。

## 检查

- 8 个前端测试文件、95 个用例通过；包含启动器、快速入口分页、翻译快捷入口、管理页与应用壳层。
- 前端类型检查通过。`bun run check` 通过；既有 226 个警告、22 个提示及 1 个生成代码设计警告保留，没有把它们改成零警告声明。
- 真实 Windows Rust 手动目录 23 项测试通过；全目标 `cargo check` 和严格 clippy 通过。仓库已有格式漂移按检查脚本作为 advisory 保留，未全仓格式化。
- 在集成分支重新运行 `build:react` 与 `bundle-css`，更新源码对应产物。除入口与管理页外，若干应用资源因内联本地化表重新生成，不能只提交 chat.js 而保留失配产物。
- 六个关键 JS 的 SHA-256 与已完成 Windows 原生验收的私有候选完全一致：chat.js、plugin-manager-view.js、app.js、tool-launcher.js、plugin-shell.js、translation-shortcuts.js。
- 全局 CSS 摘要尚不相同：视觉模块新样式尚未合入本批基线，不声称完整壳层/视觉样式已对齐。视觉集成后重新构建并核对。

## 仍需完成

- 按视觉会话针对 cf05be80 的补丁与 171 文件/21 接线回执合入视觉创作；当前批次没有替代这些实现。
- 根据翻译交接合入服务与 UI 的其余改动，完成中译英保留“三箱书”等语义复验；最近入口通过不代表译文质量通过。
- #30 当前候选原生另存的取消、路径选择、确认写入仍未通过，详见 `2026-11-16-tool-result-export-attempt.md`。
- 完整 v0.6.0 Windows 候选仍须构建、范围匹配的原生验收、数据保留核对及发行门槛；也保留 Project 中浏览器 #15 等其他计划范围，不因本批成功缩减版本清单。

本地证据：本会话工作台 `outputs/studio-v060-tools-integration.json`（明确文件清单、源摘要与前值）、`studio-v060-tools-tests.log`、`studio-v060-tools-check.log`、`studio-v060-tools-typecheck.log`、`studio-v060-tools-rust.log`、`studio-v060-tools-resource-check.json`。旧的原生失败与通过记录均保留。
