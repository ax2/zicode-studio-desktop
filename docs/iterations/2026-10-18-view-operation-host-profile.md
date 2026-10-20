# View 操作目录 Host 预览（2026-10-18）

## 目标与发现

Studio 冻结的九包目录把 Agent Assist 2 项、Spring Actuator 4 项映射为 View 操作；两包 manifest 没有单项操作目录。旧 `tool.open.v1` 仅接受真实 capability ID，不能把 View 操作伪装成可执行工具。本阶段先实现 Studio 通用接收端的版本化清单合同，不修改提供方包或 DevTools 程序。

## 修改

- Host 新增 `view.operation.directory.v1 =1.0.0-preview.1` 清单校验。`contributes.viewOperations` 必须有 1–128 项，每项显式声明 ID、标题、主 View ID、有界目录元数据及可选来源 ID。未知字段、执行字段、与 capability 冲突的 ID、未知主 View、重复别名和不兼容版本拒绝。
- 轻量插件列表只投影经过 Host 校验的 View 操作目录字段，并保留独立的 capability 列表；不会将 View 操作注册给 Pi、建立执行表单、启动 Worker 或授予权限。
- `check-plugin-manifest-profiles.mjs` 增加只读预检提示。此脚本仍明确标记 `preflightOnly`，不能替代 Host 安装。
- [版本化合同](../plugins/view-operation-directory-v1.md)标明 Host 阶段状态及后续目录、定位要求；[提供方接口需求](../plugins/view-operation-directory-request-2026-10-18.md)更新状态。

## 验证与边界

当前源码 Rust `view_operation_directory` 专项 5/5：版本、空/重复操作、未知 View、执行字段、来源/类别/别名，及真实隔离注册表安装和默认禁用的轻量列表。目录投影专项 1/1；冻结九包注册表准入在改动后复跑 9/9，均默认禁用且权限未授权。预检脚本 Vitest 8/8，Biome lint 对两份脚本通过；全文件 Biome format 提示这两份既有脚本的大范围排版漂移，未为本阶段重排。Rust 静态检查结果另记于收尾。

收尾 `bun run check:rust:static` 退出 0（Cargo check、严格 Clippy 通过；全仓 fmt 仅有既有漂移）；改动 Rust 文件定向 rustfmt 和 `git diff --check` 退出 0。成功用例没有留下 `view-operation-registry-*` scratch。前后 `storage-budget.ps1` 均退出 0：收尾 `target` 22,551,893,220 逻辑字节、task scratch 2,699,496,212 逻辑字节、E: 空闲 62,084,284,416 字节。与前态相比 target 逻辑大小增 276,088 字节，卷空闲减少较多；不把卷变化归因于本轮编译，未清理缓存。

这一阶段没有统一工具目录的单项搜索/分类/收藏/最近，未实现点击定位消息与 View SDK 回执，也没有真实 DevTools 新包或原生界面截图。用户配置及 JSON Object 禁用状态未改。新 Rust Host 源码未构建进现有 Debug EXE；没有改应用版本号、发布运行目录或生成 ZIP。DevTools 全目录完整接受仍 **0/154**。
