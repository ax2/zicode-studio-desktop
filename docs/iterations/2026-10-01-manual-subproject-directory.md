# 2026-10-01 手动选择子项目目录

状态：本地实现及静态检查完成；跨平台实机验收待补。

## 目标与发现

- 共用目录发现最多深入四层、枚举 2048 项和 64 个项目。深层 monorepo 子项目或无受支持清单的目录可能不出现在选择器中。
- 窗口内的目录状态已允许安全格式的相对路径，Host 的 `directories::resolve` 会逐级拒绝链接、非目录及越界；原界面仅能从发现列表选择。

## 修改与决策

- 在共用目录选择器中加入手动相对路径表单，供项目环境、任务、终端和存储视图使用。目录名可含空格，使用 `/` 分隔；输入不做会改变真实文件名的自动修剪。
- 新增只读 `project_task_validate_directory` 数据操作，复用已注册工作区和 `directories::resolve`。只回传请求中的相对目录确认，不暴露宿主绝对路径；前端仅在返回值与输入完全一致时切换。
- 窗口或 API 切换会让尚未完成的确认失效。手动选择不执行项目脚本；后续环境、任务、终端和存储操作仍分别重新验证目录。
- 旧 Host 缺少确认接口时显示不可用提示，避免未经确认直接切换。

## 验证、偏差与风险

- `bun run typecheck`、`bun run check`、中文词条覆盖、公共 JS 语法检查及 `bun run build:react` 通过。首次 lint 提示依赖数组用于失效旧请求，加入有解释的局部忽略后复查通过；保留仓库既有 123 条 warning、7 条 info 和 1 条设计提示。
- `bun run check:rust:static` 的 Cargo check 与 Clippy 通过；全仓库 rustfmt 仍提示已有的 advisory 格式漂移。本轮不新增或运行测试。
- 静态检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，移除本轮约 3.2 GiB 可再生构建文件。
- 目录确认与后续使用之间仍可能发生文件系统变化，Host 会在各次操作时重新验证。真实 Windows、macOS、Linux 目录和界面待验收。
- 本轮只修改本地源码及档案；未提交、推送或发布。

## 接续：数据网关接线与旧 Host 提示

- 静态复核发现前端 `HostDataGateway` 的只读操作白名单漏列 `project_task_validate_directory`，新请求会在本地发出前直接被拒绝。现已补入白名单。
- 旧 Host 返回“Unsupported data operation”时，目录选择器明确显示 Host 尚不支持手动确认；其他路径错误仍提示检查目录。没有确认响应时不改变当前目录。
- 修订后 `bun run typecheck`、`bun run check`、中文词条覆盖、数据网关 JS 语法检查及 `bun run build:react` 通过；现有 warning 和 info 数量不变。未运行测试或实机页面。
