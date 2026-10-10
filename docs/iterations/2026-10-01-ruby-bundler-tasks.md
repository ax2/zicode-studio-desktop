# 2026-10-01 Ruby Bundler 项目命令

状态：实现与静态检查完成；真实三平台验收待补。

## 目标与发现

- 环境页已有 Ruby CLI 与版本文件诊断，但 `Gemfile` 项目在命令页没有可用的固定命令。
- 现有命令目录由 Host 按清单内容生成指纹；命令只有用户主动启动后才执行。
- `Gemfile` 与 `Rakefile` 都可包含 Ruby 代码，因此读取时不解析或执行它们。

## 修改与决策

- 有 `Gemfile` 的目录提供 `bundle check` 和 `bundle install`；同时存在 `Rakefile` 时提供 `bundle exec rake` 默认任务。
- 命令只使用固定参数，任务目录仍由工作区解析器限制；`Gemfile`、`Gemfile.lock` 和 `Rakefile` 的受限读取结果进入任务指纹。
- 环境页显示 `bundle --version` 诊断，命令页说明安装与 Rake 执行可能产生的项目副作用。
- Bundler 命令显式设置当前目录的 `BUNDLE_GEMFILE`，并清除宿主继承的 `BUNDLE_APP_CONFIG`，避免被另一个项目的配置重定向。
- 只读版本探测清除 `RUBYOPT`、`RUBYLIB`、`BUNDLE_GEMFILE` 和 `BUNDLE_APP_CONFIG`，避免探测命令继承宿主的 Ruby 加载或 Bundler 项目上下文。

## 验证、偏差与风险

- `bun run typecheck`、`bun run check`、`node scripts/check-i18n-coverage.mjs` 与 `bun run build:react` 通过。
- `bun run check:rust:static` 的 Cargo check 与 Clippy 通过；全仓库格式漂移仍为 advisory，本轮涉及的 Rust 文件已单独通过格式检查。本轮不新增或运行测试。
- 补齐 Bundler 项目隔离后再次运行 `bun run check:rust:static`，Cargo check 与 Clippy 均通过；修改文件的格式检查通过。
- 静态检查后清理本轮可再生的 Rust 构建缓存。
- Rake 默认任务是否存在由项目决定；Bundler 依赖状态与真实 Windows/macOS/Linux 执行待验收。
- 本次只更新本地代码与档案；未提交、推送或发布。
