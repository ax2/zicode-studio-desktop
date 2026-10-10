# .NET SDK 选择工作日志

## 目标与发现

上一阶段的 .NET 任务只把解决方案或项目文件纳入目录指纹。但 `dotnet` 从当前工作目录向上查找 `global.json`，它可能改变实际 SDK，而宿主环境页的 `dotnet --version` 在项目外运行。

## 修改与决策

- .NET 任务读取所选目录至注册工作区根目录之间最近的 `global.json`，将路径与原始字节加入目录指纹；启动前沿用任务目录重新读取机制。
- 环境报告展示该文件相对工作区的路径及静态 `sdk.version`，不展示完整配置内容。
- 把 SDK 声明标为需要项目目录内实际确认，不使用宿主 `dotnet --version` 结果推断项目 SDK 匹配。
- 只读取注册工作区以内的文件。工作区之外祖先的 `global.json`、SDK roll-forward、预发布策略及已安装 SDK 集合仍由 dotnet CLI 在实际执行时处理。

## 验证

已通过 `bun run typecheck`、`bun run check`（111 条警告、7 条提示，命令退出码 0）、词条覆盖检查（2546 个中文词条，缺失 0）、`bun run build:react`、`cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、改动 Rust 文件的 `rustfmt --check`、MkDocs 严格构建和 `git diff --check`。未运行项目 dotnet 命令或测试。

## 遗留问题与风险

- `global.json` 的 `rollForward`、`allowPrerelease` 和 `paths` 不做完整语义解析，SDK 可用性未验证。
- 工作区外祖先配置或导入的 MSBuild 文件仍可能影响执行结果，但不进入当前目录指纹。
- Windows、macOS、Linux 的项目 SDK 选择行为尚待实机验收。

## 发布结果

本阶段仅更新本地工作区，没有发布或打包。

## 2026-09-27 接续：项目目录 SDK 探测

静态声明仍无法说明实际 SDK 选择。开发环境页现仅在所选目录有 .NET 目标或 SDK 清单时，从该目录运行有 3 秒超时、16 KiB 输出上限的 `dotnet --version`，将实际解析出的 SDK 与宿主工具版本分开显示。该命令不评估解决方案、项目或 MSBuild 目标；状态可能为缺失、失败或超时，不将声明版本与结果直接判为满足。探测继承与项目任务相同的工具目录与环境配置；设置了关闭遥测和首次运行提示的变量。

原通用工具版本探测逻辑已从接近 500 行的环境模块拆至 `host_data/environment/probe.rs`，由独立 `dotnet_probe.rs` 负责是否需要项目目录探测。探测输出须是 SDK 版本形态，否则报告失败，不把欢迎横幅当作版本。此次接续已通过 `bun run typecheck`、`bun run check`（111 条警告、7 条提示，命令退出码 0）、词条覆盖检查（2550 个中文词条，缺失 0）、`bun run build:react`、`cargo check --locked --all-targets`、`cargo clippy --locked --all-targets -- -D warnings`、改动 Rust 文件的 `rustfmt --check`、MkDocs 严格构建和 `git diff --check`。未执行项目构建或测试；Windows、macOS、Linux 的实际探测结果仍待验收。
