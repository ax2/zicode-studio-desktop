# Cargo 缓存持续观测（2026-10-17）

## 目标与方法

复核 10 月 15 日关闭 dev/test 增量编译后的实际磁盘趋势，为当前 Studio 开发和插件验收保留有用缓存。只读运行 `scripts/storage-budget.ps1`，独立枚举 `target/debug/incremental` 文件，并核对 `[profile.dev].incremental=false`、Debug/Release EXE 与活动构建进程。本轮不构建、不测试、不删除、不改应用版本。当前 Git HEAD 为 `72f4b0ee99dff4778d407a66a78330a275593341`，工作树另有未提交工作，未覆盖。

## 观测

- 完整扫描退出 0，四棵树 `UnknownEntries=0`：`target` 29,424,103,509 B / 74,777 文件；`.cache`（不含 task-scratch）355,458,670 B；task-scratch 938,160,282 B；`site` 29,644,753 B。E 盘当时可用 36,344,004,608 B。各数为逻辑字节，卷空闲变化不能归因单一项目操作。
- `target/debug` 为 24,719,965,995 B，其中 `deps` 17,344,560,748 B、`build` 3,191,305,864 B、`incremental` 2,790,120,589 B；`target/release` 为 4,704,136,231 B。Debug 和 Release 的 EXE 均仍在各自目录。
- `target/debug/incremental` 仍是 **24 个目录、1,799 个文件、2,790,120,589 B**，与 10 月 15 日修改配置后的数值完全相同；最新文件写入为 2026-10-15 22:00:59 +08:00，早于当前 `Cargo.toml` 的 22:14:04 写入。此后已进行了 Studio 的多轮编译/检查，但没有新增该目录的文件。这支持“新配置阻止此类旧增量目录继续增长”的本机观测，不证明所有 Cargo 缓存都不增长。
- 活动进程检查没有发现命令行指向本仓库的 Cargo、rustc、Bun 或 Tauri 构建进程。运行中的 Studio PID 3632 是用户安装版 `C:\Users\ax2\AppData\Local\ZiCode Studio Desktop\zicode-studio-desktop.exe`，不是本仓库 Debug EXE；未操作该进程。

## 清理边界与后续

这 24 个旧增量目录是 **至多 2,790,120,589 逻辑字节的人工复核候选**，不是已经释放的空间。当前 `incremental=false`，它们不会用于同配置的后续增量编译；但若将来重新启用旧配置，可能再次编译。历史文档记载对部分旧增量目录的自动删除已被 `blocked by policy` 拒绝；本轮没有重试、改用其他工具或清空 `target`。`deps`、`build` 和现有运行目录仍保留供后续开发复用。

用户如手工整理，应先关闭本仓库构建，复核当前配置、目录内容和阶段证据，再仅处理确认不再使用的旧增量目录；操作后重新运行只读扫描，分别记录文件/逻辑字节和卷可用空间。若要从根本上显著缩小 29.4 GB 的 `target`，还需对依赖编译配置、可复用产物和真实构建耗时做证据化评估，不能按“仅保留最后一个版本”误删 `deps`/`build`。

插件目标没有因本轮存储审计而缩减：DevTools 154 项完整接受仍为 0，ZiFile 108 个操作完整接受仍为 0；正式签名包和跨平台原生验收继续待办。
