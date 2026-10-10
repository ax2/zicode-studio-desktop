# 2026-09-27 pnpm 工作区与 glob 发现

状态：实现与静态检查完成，运行验收待进行。上一轮完成根 JS/Cargo 声明的有限目录发现，本轮补齐 pnpm 与常用 glob。

## 计划与决策

- 使用 yaml-rust2 的流式事件 API 读取根 pnpm-workspace.yaml 的 packages；不执行 pnpm，不展开 YAML alias，不加载无关配置对象。
- 使用 glob 的模式匹配功能扩展 `*`、`?`、字符组和整段 `**`；由现有受限遍历器访问目录，避免使用库的无界文件遍历。
- pnpm 的 `!` 模式作为排除项；排除只影响声明扩展，普通扫描继续发现独立项目。列表不宣称精确 workspace 成员身份。
- 保留 256 KiB 清单、128 模式、32 段目录、2048 声明步进/目录项、64 合并目录上限。只读根声明，不解析依赖图或父配置继承。
- 静态检查使用 Cargo check、Clippy、MkDocs 与差异检查；不新增或运行测试、不启动项目命令，不发布。

## 实现与资料依据

- pnpm_workspace.rs 使用 YAML 事件读取：最多 16384 个事件、无关值最多 64 层；只存根键与最多 128 个 packages 字符串。拒绝重复根键、根合并、多个文档及 packages 别名/标签/非字符串；跳过无关配置不展开别名。
- workspace_patterns.rs 使用 glob 0.3.3 匹配单段，由声明模块自行 BFS。递归 `**` 支持零段或多段，按路径/模式位置去重，实际目录深度最多 32；排除匹配追加虚拟子项以保留尾部 `**` 的零段语义。不支持 brace/extglob。
- pnpm 文件优先于 JS workspaces；空文件、根 null、缺少 packages 或 packages 为 null 时默认 `**`，空数组与仅排除数组不合成包含模式。Cargo 声明仍独立参与。默认/空数组语义参照本轮读取的 pnpm 当前源码，不宣称完全复刻包管理器成员判定。
- 源码资料：[findPackages.ts](https://github.com/pnpm/pnpm/blob/main/pnpm11/workspace/projects-reader/src/findPackages.ts)、[package-patterns](https://github.com/pnpm/pnpm/blob/main/pnpm11/workspace/package-patterns/src/index.ts)。初始旧路径返回 404，随后通过仓库树定位现有源码。资料读取时间 2026-09-27。
- 空值处理另参照 [workspace-manifest-reader](https://github.com/pnpm/pnpm/blob/main/pnpm11/workspace/workspace-manifest-reader/src/index.ts) 的校验规则；当前平台只提取路径，不执行 pnpm 对其他字段的完整校验。
- 固定 yaml-rust2 0.13.0（关闭 encoding feature，仅接受 UTF-8）与 glob 0.3.3。锁文件比较仅新增 arraydeque 0.5.1、hashlink 0.12.2、yaml-rust2 0.13.0，没有移除或升级原有版本。yaml-rust2 最低 Rust 1.85，本机 1.88，现有 CI 使用 stable，跨平台实际编译仍待验收。
- project_tasks/mod.rs 仅增加两个模块声明并由 rustfmt 排序，属于大型文件的最小接线；没有修改前端协议或 UI。
- 最终 Cargo check --locked --all-targets 与 Clippy --locked --all-targets -- -D warnings 通过，源码 rustfmt 与差异空白检查通过。日志前缀 E:\tmp\zicode-pnpm-。
- 中英文帮助、平台说明和 MkDocs 导航已同步，MkDocs strict 构建通过。

## 验收边界与遗留

- 不新增或运行测试，没有真实 pnpm/Cargo 仓库运行验证，没有 UI 或 macOS/Linux 实机验证；静态编译不证明这些流程已完成。
- 根清单和 glob 是目录发现依据，普通扫描仍可能找到被声明排除的独立项目；不提供完整包成员、依赖图、任务继承或包管理器配置校验。
- 项目命令、环境诊断、终端沿用既有目录协议；本轮没有前端代码修改，没有重新生成前端 bundle，没有提交、推送、构建安装包或发布。
- 后续继续目录发现的真实仓库验收、工具链配置继承、Conda/Poetry 环境与跨平台运行验证。
