# 2026-09-30 Rust 工作区版本继承

状态：实现和静态检查已完成；真实工作区验收待办。

## 目标与发现

- 成员 `Cargo.toml` 写入 `package.rust-version.workspace = true` 时，环境页此前只能显示尚未解析的继承要求；同文件中声明的 `[workspace.package] rust-version` 已可直接解析。
- 项目任务目录发现已有受限的 Cargo `members` / `exclude` 匹配器，可以判断祖先工作区是否明确包含选中的成员目录。

## 修改与决策

- 仅当成员清单明确请求继承、成员自身不是新的工作区根、最近的祖先工作区明确包含它，且该工作区提供字符串形式的 `[workspace.package] rust-version` 时，解析为最低 Rust 版本。
- 不读取注册工作区边界之外的父目录；最近的工作区排除成员、缺少版本或清单错误时保留“继承未解析”，不继续从更远祖先借值。
- 成员清单若包含自己的 `[workspace]`，不按祖先推断。显式 `package.workspace` 路径只在可解析为注册工作区内部的祖先目录、目标存在 Cargo 工作区、成员未被 `exclude` 排除且存在版本声明时使用；这种显式指针不要求再出现在 `members` 中。
- 环境页将成功解析的值标为“继承的最低版本”，继续使用现有宿主默认 `rustc` 版本比较，避免把工作区值误认为成员清单本地声明。
- 沿用有界清单读取和现有宿主默认 `rustc` 比较；不会执行 Cargo 或下载工具链。

## 验证、偏差与风险

- `bun run check:rust:static` 两次通过 `cargo check --all-targets` 与严格 Clippy；全仓格式检查仍提示既有 advisory 漂移，定向 `rustfmt --check` 通过。
- `bun run typecheck`、`bun run check`、`bun run build:react` 和翻译覆盖检查通过；翻译字典 2829 键，缺失 0。静态检查仍输出仓库现有 123 条 lint warning、7 条 info 和 1 条设计提示。
- 检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，移除本轮生成的 3.2 GiB Rust 构建产物。本轮不新增或运行测试。
- Cargo 的隐式成员仍未纳入继承判断；显式 `package.workspace` 指向注册工作区外、非祖先目录或无效目标时保留未解析状态。
- 尚未用真实多包 Rust 工作区及 Windows、macOS、Linux 桌面界面验收。
- 本轮仅更新本地源码和档案；未提交、推送或发布。

## 接续：显式工作区路径

- 读取成员 `package.workspace` 的相对路径，规范化后只接受注册工作区内的祖先目录；绝对路径、越界路径、非祖先和无效目标都保留未解析状态。
- 目标必须有可解析的 Cargo 工作区声明，且没有通过 `exclude` 排除该成员。显式指针本身表明成员意图，因此不要求目标的 `members` 再列出它；隐式成员仍要求明确 `members`。
- 定向 `rustfmt --check` 通过。`bun run check:rust:static` 再次通过编译检查与严格 Clippy；全仓格式 advisory 仍存在。检查后 `cargo clean` 移除本轮生成的 3.2 GiB 构建产物。未新增或运行测试，真实 Cargo 工作区验收待办。
