# 当前 Debug 运行目录与 Pi 版本复核（2026-10-18）

## 目标与修改

将已实现但尚未写入旧 Debug EXE 的 Studio 改动编入当前复用目录，并确认本机运行的确是新程序。保持开发版 `0.4.2`，不发布、不生成 ZIP，也不改动 DevTools 或 ZiFile。

## 上游与构建证据

- 2026-10-18 查询上游 [Pi v1.3.0 Release](https://github.com/earendil-works/pi/releases/tag/v1.3.0)；GitHub `releases/latest` 为 `v1.3.0`，发布时间 `2026-10-15T19:17:33Z`。六个平台资产的 GitHub 发布摘要逐项匹配 `scripts/pi-version.json`，故本轮无需更新内嵌 Pi。
- `bun run build:local` 成功，复用 `target/debug`，主程序 Rust 编译约 1 分 15 秒。Pi、PortableGit、WebView2、Bun 本地资源均命中现有缓存。
- 新 EXE：`target/debug/zicode-studio-desktop.exe`，125,421,056 字节，SHA-256 `4F19F9952D216755B2420684F8C226623A5ADEB8369D5F6BD50EC011A97EB4FC`。未创建第二套 Cargo target 或发布目录。

## 原生窗口观察

直接启动 Debug 路径时，单实例交接唤起了 `C:\Users\ax2\AppData\Local\ZiCode Studio Desktop\zicode-studio-desktop.exe`；该窗口不能作为新 Debug 的证据。随后新建自有空隔离 profile，以 `--isolated-profile` 和 `--tools-only` 启动，新进程 PID 64084 的可执行路径核对为上述 `target/debug` EXE。

Computer Use 在新进程的 1442×931 窗口观察到“已连接”的应用与工具中心，目录筛选、搜索框和双列工具卡片正常显示，共 16 个当前配置工具；没有安装或启用 DevTools 候选。初次截图被微信窗口遮挡，激活目标窗口后重新截图检查；不能把第一张当作无遮挡布局证据。隔离日志仅有 Host automation runner 与工具会话启动的 INFO，已保存至技术博客对应阶段的 `isolated-debug.log`。检查结束后核对进程路径并结束本轮启动的 Debug 与旧安装版进程，进程清单无 Studio 主进程。

这是 Windows 新 EXE 主界面烟测；没有验证 DevTools 0.1.3 原生安装、权限、View 点击、Pi 自主选工具、ZiFile 算法或 macOS/Linux。DevTools 完整接受仍 0/154，ZiFile 仍 0/108。

## 磁盘与遗留

构建前 E: 空闲 63,089,672,192 字节。隔离 profile 位于 `.cache/task-scratch/studio-native-smoke-fee50f95-c2d5-481b-8d96-83efec15e5c1/`，停止后 77,726,013 逻辑字节；377 字节日志已另存技术博客。针对该确切目录的清理命令经路径归属、进程退出与日志归档检查后被自动审批以 `blocked by policy` 拒绝，实际删除 **0**，不换方法重试。手工候选仅为 `E:\zicode-studio-desktop\.cache\task-scratch\studio-native-smoke-fee50f95-c2d5-481b-8d96-83efec15e5c1`；其他 scratch、Cargo 缓存和运行目录不在此范围。构建后只读扫描 E: 空闲 62,650,404,864 字节，较构建前少 439,267,328 字节；卷变化包含同期其他活动，不全部归因于本构建。
