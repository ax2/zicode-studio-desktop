# 2026-10-01 Ruby 开发环境识别

状态：实现与静态检查完成；真实三平台验收待补。

## 目标与发现

- 开发环境页已有通用工具探测与版本管理器要求比较，但缺少 Ruby CLI 和 `.ruby-version`。
- 子项目目录发现能展示构建清单及部分版本配置目录；Ruby 的 `Gemfile` 和独立版本配置目录尚不可选。
- `Gemfile` 是 Ruby 代码，不在只读诊断期间解释或执行。

## 修改与决策

- 增加 `ruby --version` 只读探测，并识别 `Gemfile` 和 `.ruby-version`。版本文件限制为单个非空声明；只比较精确的 `X.Y.Z`，其他声明保持不支持状态。
- 子项目缺少 `.ruby-version` 时，沿工作区内部父目录读取最近的版本文件；沿用现有的大小、路径和深度边界。
- Ruby 版本配置目录及 `Gemfile` 目录可在共享目录列表中选择，但不凭这两种文件生成固定任务或执行 Bundler。

## 验证、偏差与风险

- `bun run typecheck`、`bun run check`、`node scripts/check-i18n-coverage.mjs` 与 `bun run build:react` 通过。
- `bun run check:rust:static` 的 Cargo check 与 Clippy 通过；全仓库格式漂移仍为 advisory。本轮不新增或运行测试。
- 静态检查后清理本轮可再生的 Rust 构建缓存。
- Ruby CLI 的不同发行版输出、真实 Windows/macOS/Linux 运行和 Bundler 工作流尚未实机验收。
- 本次仅更新本地代码与档案；未提交、推送或发布。
