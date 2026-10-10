# 2026-09-26 项目命令持久运行历史

状态：Windows 实现与自动检查完成；跨平台及原生界面验收待推进。

## 发现与方案

- 命令记录与输出当前只存在 Host 内存中，重启后丢失。
- 在应用数据目录独立 SQLite 中保存运行元数据，按注册项目路径与工作区 ID 共同隔离；每项目最多 40 条、全局最多 500 条。
- 保存任务名、目录、工具类别、清单指纹、开始/结束时间、状态和退出码。命令正文、调用参数、解释器路径、stdout/stderr 继续仅在当前会话内保留。
- 已保存但没有最终结果的记录显示“状态未确认”，不伪装成仍可停止的活动进程，也不猜测另一 Host 是否已经退出。
- 数据库不可用不阻止命令运行，但展示历史保存失败；不得用空列表掩盖读取错误。
- 提供桌面端按项目清理历史，保留当前 Host 活动命令；远程客户端只读。
- 进程收尾与历史落盘纳入可等待退出，避免数据库句柄晚于 Host 关闭屏障释放。

## 实现进展

- 独立 `project_tasks/history.rs` 与 `history_api.rs` 管理 SQLite、摘要白名单、作用域与保留策略；前端输出和历史视图拆分为 `ProjectRunHistory.tsx`。
- 数据库在应用数据目录的 `project-run-history.sqlite3`，不接受客户端指定路径；SQLite 事务写入并裁剪，每次等锁最多 100ms。
- 保存失败在本次 Host 内持续标记 `unavailable`，之后一次成功读取不能证明之前所有写入完整。读取失败保留最近访问的最多 12 个项目的摘要缓存；无缓存时为空并明确标记不可用。
- 清理事务失败不删除内存记录；成功清理仅保留当前 Host 所属活动命令。远程 Host 路由及只读网关拒绝清理请求。
- 通过 TaskTracker 等待子进程收尾、stdout/stderr 读取结束与最终摘要写入；与连接回收并行共享 8 秒退出等待上限。
- 已通过第一轮 8 个新增 Rust 历史测试及 21 个聚焦前端/网关测试；修复 Clippy 报告的旧内存列表接口仅供测试使用问题，完整平台复验已通过，保留既有格式与 lint 提示。

## 实现边界

- 子进程创建与首次摘要写入不是同一原子操作，极短窗口内崩溃可能没有记录；没有最终写入的旧记录只显示 unknown，不推断成功或失败。
- 多 Host 共享 SQLite，但并不接管彼此进程，也不在启动时改写对方状态。清理后另一 Host 的活动命令完成仍可能写回摘要。
- 内存总量仍为 40 次运行，每路输出 64 KiB；磁盘 40/500 上限约束摘要条数，不构成无限期审计档案。项目注销与历史清理独立。
- 任务名和相对目录仍是用户/项目提供的元数据；没有保存命令正文和输出不等于所有元数据均无敏感内容。
- Windows 本轮验证不代表 macOS/Linux 或原生 WebView 视觉验收；不制作安装包，不发布。

## 本轮验证结果

- `bun run check:platform --out E:\tmp\zicode-command-history-evidence`：10 项必需检查全部通过；Rustfmt 仍为既有全局格式漂移 advisory。
- 前端/扩展/网关：37 个文件，479 项测试通过，其中新增命令历史 UI 测试 7 项。
- Rust 默认测试：346 项通过（5 + 19 + 322），5 项 ignored；新增历史测试 8 项。真实 Cargo/Go 项目与 Python `.venv` 生命周期专项另行通过。
- 真实 WebSocket Host 测试覆盖启动、退出、重建 Host、摘要恢复、最终取消状态落盘、错误工作区拒绝以及桌面端清理；远程写入禁止与只读网关限制均有自动检查。
- `bun run check`、TypeScript、Windows 子进程规则通过；中英文 2253 个键，缺失 0。Biome 仍有既有 111 warnings / 7 infos，没有新增数量。
- React 资源已重建，仅保留本功能及此前已有改动的 bundle；MkDocs strict 与 `git diff --check` 通过。
- Windows 证据：`E:\tmp\zicode-command-history-evidence\win32-x64-ae96e76b-73ce-45fb-87e8-d77955829bdb\summary.md`。
- 最终 `bun run check:rust` 再次通过，记录：`E:\tmp\zicode-command-history-rust-verified.log`。
- 本轮没有原生 WebView 截图/点击验证，也没有 macOS/Linux 实机、安装或发布验证。Host 主文件仅接入 runner 构造和控制操作路由，新增逻辑放入独立模块。
