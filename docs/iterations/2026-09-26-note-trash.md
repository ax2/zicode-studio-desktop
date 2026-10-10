# 2026-09-26 回收站操作隔离

状态：实现与静态检查完成，运行验收待补。本轮不新增或运行测试。

## 发现与设计

- 回收站写操作缺少作用域和并发保护，恢复后使用 preserveSelection:false，迟到响应可修改新工作区状态。
- 读取已有工作区检查但缺请求顺序检查；旧列表可能覆盖操作后的新列表。
- 清空接口删除执行时所有条目，而非确认时显示的集合；界面双确认状态还复用同一个定时器，两个操作可互相影响。
- 提取回收站服务与界面。固定工作区、限制同一工作区串行写、清空限定当前列表快照并保留失败项。Host 在已有 Vault 锁内校验可选版本/删除时间，拒绝过期条目。

## 实现记录

- `trash-actions.ts`：读取序列与写入序列分别检查，同一工作区写入使用 trashBusy；恢复刷新 preserveSelection:true，已派发请求始终固定 scene/workspace。
- 清空捕获显示列表，不再调用无条件 emptyTrash 接口；逐个带 expectedVersion/expectedDeletedAt 删除，移除确认成功的条目，保留失败并刷新。切换工作区停止后续派发。
- `TrashView.tsx` 提取原界面，统一单个确认状态和自动清理定时器；条目键包含笔记本、笔记 ID、版本和删除时间。加载错误不显示“回收站为空”。
- `trash_guard.rs` 在现有 scoped Vault 进程锁和 Host notes 锁持有期间检查版本与时间，再恢复或永久删除；仅传一个条件或空条件拒绝。为兼容旧客户端，两字段均省略时仍按旧契约执行；旧 Host 可能忽略字段。
- 正文列表加载不再把“过滤/截断列表没找到笔记”当作删除证据，避免恢复操作的刷新关闭当前编辑器。明确筛选和删除仍由其动作控制选中状态。
- 大型 notesStore/NotesApp/host_server/notes_vault 只增加接线、字段和最小选择保留调整，业务逻辑在独立模块中；中英文帮助与导航同步。

## 边界与发现

- 没有运行测试或真实回收站操作。跨窗口条件冲突、部分失败、切换、视觉和跨平台仍待验收。
- 旧客户端/旧 Host 兼容路径不提供条件校验保证；没有声称已取消旧全量清空端点。外部编辑器不遵循 Vault 锁。
- Host 读取回收站有既有自动保留期清理；静态查看还发现删除时间来自文件 mtime，删除时未显式重设时间，旧文件的保留期语义需下一阶段处理。
- 版本与 mtime 不代表独立删除事件 ID；内容和时间完全相同的条目再次进入回收站时不能区分事件。永久删除的文件与附件清理仍非单事务。
- 无提交、推送或发布。Rust 仅运行 check/Clippy，避免调用包含 cargo test 的 check:rust 脚本。

- 复查补充 trashLoaded 状态，首次读取成功前或读取失败后禁止删除，错误状态不伪装为空。

## 静态检查结果

- TypeScript、`bun run check`、React 构建、MkDocs strict 构建和差异空白检查已通过。
- 中英文覆盖 2380 键、0 缺失。静态扫描维持既有 111 warnings、7 infos；生成 xterm 模块仍有既有 1 条内联尺寸提示。
- `cargo check --locked --all-targets` 与 `cargo clippy --locked --all-targets -- -D warnings` 均通过，耗时分别 3m 16s、2m 15s；没有运行 Rust 测试用例。
- 证据前缀 `E:\tmp\zicode-notes-trash-`，包括 cargo/clippy/types/static/i18n/react/docs 与 diff-warnings 日志。
