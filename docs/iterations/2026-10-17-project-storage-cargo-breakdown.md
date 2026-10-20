# 项目存储页显示 Cargo 构成（2026-10-17）

## 目标与发现

项目存储页原先只显示 `target` 总量，用户难以区分当前 Debug/Release 运行目录、可复用的 `deps`/`build` 和旧 `incremental` 会话。直接清空 `target` 会导致大量依赖重新编译，也可能破坏保留的运行目录。本阶段在 Studio 内提供只读分项，沿用现有有界扫描；DevTools 与 ZiFile 仍由各自项目开发，本轮未修改。

## 修改

- Rust 项目存储扫描在同一次目录遍历中累计 `target/debug`、`target/release`、`target/debug/deps`、`target/debug/build`、`target/debug/incremental`。不为每项再次遍历整棵树。链接、不可读项和部分扫描保持保守状态；父目录不完整时，分项也不能显示为完整。
- 页面显示各项及其状态，标明子目录大小已计入 `target`，不可重复相加；分别提示保留当前可运行版本、复用编译缓存和核对旧增量会话。没有自动删除按钮，也没有改变清理策略。
- 沿用当前本地 Debug 构建目录和 Pi 等已下载资源，未改应用版本，未产出 ZIP 或新的 Release 目录。

## 验证证据

- 构建/测试前 `storage-budget.ps1` 完整扫描退出 0：`target` 29,427,163,277 逻辑 B、task-scratch 938,160,282 B、E 盘可用 36,342,956,032 B；未知项 0。
- 项目前端专项 11/11，Rust 新增单次扫描/部分状态专项 1/1；`bun run check`、`bun run typecheck`、`bun run check:rust:static` 均退出 0。Rust 全仓库格式检查仍有既有格式漂移。`bun run build:local` 成功，复用 `target/debug`；运行时资源检查显示 Pi、Portable Git、WebView 与 Bun 已就绪，无重复下载。
- 在独立验收 profile 下启动本工作树 Debug EXE，打开合成的 10 B `target` 项目。Windows 1442×931 实际界面显示 `target` 10 B/4 文件、Debug 6 B/3、Release 4 B/1、`incremental` 3 B/1、`build` 2 B/1、`deps` 1 B/1，六项均为完整；分项说明与“不可重复相加”提示可读，滚动后未裁切。[实际界面截图](<C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/screenshots/project-storage-cargo-2026-10-17/windows-desktop.jpg>)已归档。此证据是小型合成项目的当前 Windows Debug 窗口，不是对 29 GB 本仓库或 macOS/Linux 的界面验收。
- 隔离 Debug 进程及采样子进程已退出；原有用户安装版 Studio PID 3632 未操作。
- 构建和界面验证后只读扫描退出 0：`target` 29,431,915,600 B/74,825 文件，task-scratch 936,862,523 B/33,155 文件，E 盘可用 36,294,418,432 B，未知项 0。`target` 较本阶段起点增加 4,752,323 逻辑 B；卷空闲及 scratch 净变化受其他活动影响，不能归因本阶段清理。

## 清理边界与遗留

本次合成项目位于 `E:\zicode-studio-desktop\.cache\task-scratch\storage-native-20261017`。停止确切验收进程并核对 owner 与路径后，曾对这个 6 文件、151 逻辑 B 的目录提出一次精确 PowerShell 删除；**自动审批在执行前返回 `blocked by policy`，实际删除 0 B**。没有换工具或命令重试。该路径只作为人工复核候选；处理前重新核对路径和进程，处理后以只读扫描确认。既有 Cargo 缓存、Debug/Release 运行目录和其他工作的未提交修改均保留。

DevTools 154 项完整接受仍为 0/154，ZiFile 108 个操作仍为 0/108。正式签名包、全部工具真实流程和非 Windows 验收继续待办。

## 当前大型项目原生复验与扫描公平性修复

随后使用同一隔离 profile、本工作树的真实 `E:\zicode-studio-desktop` 工作区以及 `--open-file README.md` 的 tools-only 入口，检查 1442×931 Windows Debug 窗口。首次真实扫描发现原先共用的 5 秒截止时间被先扫描的 `node_modules` 耗尽，`target` 和全部 Cargo 分项只能显示“≥ 0 B / 扫描不完整”。这不是有效的实际项目磁盘说明。

Rust 扫描器现在对存在的候选根目录并行启动只读读取，共享原有 5 秒截止时间；每个目录仍受 100,000 条目、64 层深度、最多 1,024 个排队目录约束，Tauri 原有单扫描准入与 8 秒响应门槛保留。单个目录内部改为每轮最多 64 条的广度轮转，避免先遇到的 Release、`deps` 或其他大分支耗尽时间。仍是**一次遍历**，Cargo 分项从 `target` 同次扫描累计；链接与不可读状态仍为部分/未知。页面还把“部分扫描但观测字节为 0”显示为“尚未取得大小”，不把 0 当作实测值。

- Rust 静态检查与严格 Clippy 退出 0；全仓库 rustfmt 仍有其他既有漂移，本文件已单独格式化。Rust 项目存储专项 2/2（包含预算达到上限时 Debug/Release 均取得条目的用例）。前端项目存储 12/12、TypeScript 类型检查与 `bun run check` 退出 0；全仓库 Biome 仍有非阻塞提示。`bun run build:local` 复用现有 Debug 输出，Pi 等运行资源已就绪，没有版本号变更或 ZIP。
- 最终真实项目原生页面显示：`target ≥3.2 GiB`、Debug `≥2.2 GiB`、Release `≥979.5 MiB`、Debug/incremental `≥906.4 MiB`、Debug/build `≥383.0 MiB`、Debug/deps `≥18.0 MiB`，均标明扫描不完整，不能与完整盘点或可回收空间画等号。下滚后各卡片未见遮挡。[实际项目截图](<C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/screenshots/project-storage-cargo-2026-10-17/windows-real-project.jpg>)保存为 1442×931。前两轮真实扫描的 0 B 及 Release 偏置作为发现过程保留，不宣称一次修复得到完整大小。
- 完整只读 `storage-budget.ps1` 从 29,431,915,600 B/74,825 文件到 29,435,841,931 B/74,858 文件，未知项 0；`target` 增加 3,926,331 逻辑 B。task-scratch 从 939,048,316 到 937,893,489 逻辑 B；E 盘可用从 36,335,583,232 到 31,576,530,944 B。卷可用空间下降远大于本仓库 `target` 的逻辑增量，期间有其他 Cargo/rustc 进程；不能把整段卷变化归因于本阶段或声称本轮释放了空间。没有重试任何被拒绝的清理。三个隔离 Debug 启动均已结束，用户安装版 Studio PID 3632 未操作。

仍待实现按需深度盘点或其他能得到完整 `target` 构成的路径：5 秒界面快扫在 29.4 GB / 74,858 文件项目上只能给出下界。此项不阻碍当前编译或插件接入，但不能拿快扫结果制定精确删除计划。
