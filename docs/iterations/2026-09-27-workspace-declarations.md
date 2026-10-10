# 2026-09-27 仓库声明与子项目发现

状态：实现与静态检查完成，运行验收待进行。目标是在共享目录选择中补充仓库明确声明的深层成员。

## 发现与设计

- 现有目录发现只扫描四层，深层成员即使在根清单声明也不会进入选择器。
- 独立模块读取根 package.json workspaces（数组或 packages 对象）与 Cargo.toml workspace.members/exclude；沿用清单 256 KiB 限制。
- 本轮支持工作区内相对路径和整段 `*`，不支持递归 `**`、部分段通配符或完整 glob 语法。拒绝链接、父级跳转、绝对路径及依赖/构建目录；声明解析不执行包管理器。
- 声明扩展最多 128 个模式、32 段深度、2048 次路径步进/目录项；普通四层扫描另有 2048 项预算；合并结果最多 64 个目录（含根）。优先保留声明成员。
- Cargo exclude 只约束声明扩展，普通扫描仍可发现独立项目；不把全部发现目录宣称为 workspace 成员。不解析依赖图或继承配置。

## 工作记录

- workspace_declarations.rs 独立实现清单读取、声明校验、Cargo 排除匹配和有界目录扩展，未引入依赖或改动锁文件。清单读取复用现有 reader；子目录逐段使用现有 resolve 拒绝目录链接与越界路径。
- 声明中任何模式不支持或无效时整份声明跳过，普通扫描继续；pnpm-workspace.yaml 存在、清单读/解析失败、预算耗尽、声明目录缺失或没有受支持清单时标记 incomplete。
- directories.rs 先保留根与声明目录，再执行普通扫描并去重；返回协议保持不变。project_tasks/mod.rs 只增加模块声明，属于大型文件的最小接线。
- 共享选择器增加 API 身份检查，API 切换后旧结果立即隐藏；不完整提示覆盖声明解析情况。中英文帮助、平台说明和 MkDocs 导航同步。
- TypeScript、前端检查、i18n 和 React 构建已通过；2504 键、0 缺失，保留既有 111 warnings、7 infos 与 xterm 内联尺寸提示。构建后恢复本轮前干净的无关 bundle。
- Cargo check --locked --all-targets 与 Clippy --locked --all-targets -- -D warnings 通过；Rust 文件已用 rustfmt 格式化。MkDocs strict 与差异空白检查通过；日志前缀 E:\tmp\zicode-workspace-declarations-。
- 不新增或运行测试，不启动项目命令或终端，不发布。

## 遗留与验收边界

- 本轮为实现和静态检查；尚未验证真实 monorepo、UI 交互和 macOS/Linux 文件系统行为。没有提交、推送或发布。
- 只读取工作区根声明，不递归解析成员自身的 workspace 声明，不自动解析 Cargo 路径依赖隐式成员，也不提供精确成员身份或依赖图。
- 目录发现仍是有界快照；触及预算时返回部分结果并提示不完整。环境、清单、命令与终端请求仍各自重新校验所选目录。
- 后续推进 pnpm YAML、完整模式解析、真实目录和跨平台运行验收。
