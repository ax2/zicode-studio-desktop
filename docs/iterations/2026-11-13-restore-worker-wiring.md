# Windows 离线恢复与 Worker 接线（2026-11-13）

关联 Project #4 / Issue #31。开发版本仍为 0.5.3；本记录不代表新发行包或个人资料升级完成。

`restore_workspace_backup` 保留已注册工作区解析校验，改为持久排队，返回请求回执。`workspace_restore_outcome` 读取该工作区的持久结果，已加入命令注册和默认权限。启动在注册默认工作区后、读取会话和打开应用数据之前检查所有注册根；仅存在待处理恢复时，先取得 Worker 维护租约，再应用恢复。

Worker 复用原维护锁与正常停止请求。`WorkerInstance` 在打开 metadata 之前持共享锁，直到 Host 排空和 Pi 停止之后才释放；启动器与 Worker 的共享锁交叠。恢复租约不新增更新后的自动重启意图，正常软件更新仍保留原来的恢复 Worker 行为。

集中验证发现并修复两处问题：

- 首次备份的 system 控制目录尚不存在，取锁返回 Windows 错误3。备份模块现在仅创建所需的 system 这一层，缺失资料父目录仍报错，不创建替代资料库。
- Worker 仅用 `ErrorKind::WouldBlock` 判断锁竞争，实际 Windows 锁回归失败。六个锁判断补充匹配 `fs2::lock_contended_error()` 的平台错误码。

本机结果：备份13项通过；新增维护锁4项通过，覆盖真实文件锁下的停止等待、排他期间阻止重新启动、不新增自动重启意图、更新仍保留重启意图、旧 Worker 实例锁以及启动器到 Worker 的交接。每项在独立子进程和自有合成资料中运行。这些是文件锁/生命周期契约测试，尚不等于实际 Worker 执行任务或设置页到重启恢复的完整原生验收。

原始失败和修复后日志位于主会话证据目录 `outputs/restore-wiring-{backup-tests,maintenance-tests,backup-fixed,maintenance-fixed}.log`。权限检查78个命令通过；Rust 严格静态检查和新原生程序验证的最终结果另行补充。

主入口仅接线；新增测试放在 `automation_worker/maintenance_tests.rs`。未修改个人固定资料、启动自动任务、调用收费模型或构建其他平台。损坏/丢失快照的排队请求撤销与启动错误恢复入口仍须完成，不能把持续启动失败当作完整恢复流程。

最终静态检查：全目标 cargo check、严格 Clippy 通过，check:rust:static 退出0；仓库既有格式漂移仍为提示。原生端到端验证交接给 #31 负责会话，当前未替换或安装主 EXE。
