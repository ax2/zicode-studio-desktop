# Windows 托盘保活与窗口恢复（2026-10-17）

## 目标与发现

托盘右键菜单的收藏/最近/项目工具入口已有源码和路由证据，实体任务栏菜单点击仍待验。本轮先在当前 0.4.2 Debug 的隔离 `--tools-only` 环境核对关闭窗口后的生命周期与恢复，避免把菜单接线误认为完整实体验收。

## 真实窗口验证

启动 `target/debug/zicode-studio-desktop.exe --isolated-profile <本项目既有隔离 profile> --tools-only`，原 PID 58876 的 Windows 工具中心显示“已连接”及 24 项目录工具。点击系统窗口关闭按钮后，UI 窗口从可见列表消失，原 PID 58876 仍存活。代码只在 `desktop_tray::available` 成立时隐藏窗口，因此该结果也证明本轮进程成功安装了 Tauri 托盘对象；它不证明任务栏图标已被实体右键点击。

同 EXE、同隔离 profile 不带工具参数二次启动，临时 PID 53252 退出；原窗口句柄 55513216 恢复可见，保持原工具中心、已连接状态及 24 项目录工具。隔离日志出现 `receiving secondary launch: regular`。随后核对原 EXE 路径及 profile 参数并停止 PID 58876；没有遗留 Studio 测试进程。

代表性 Windows 1442×931 浅色截图已实看并存入技术博客 `screenshots/tray-lifecycle-2026-10-17/windows-tools-restored-1442x931.png`（100,841 B，SHA-256 `63EAAD33543718F7F7000D01E7F9E6974C649BF061AB78C30648F88FE533B0A6`）。托盘是桌面系统入口，没有对应移动端截图。

## 边界与空间

当前 Computer Use 可操作窗口列表不暴露 Windows 任务栏通知区域，未直接点击实体托盘图标或其右键菜单；收藏、最近、当前项目和退出菜单项仍只能引用已有源码/自动化证据，不计本轮原生验收。macOS/Linux 托盘也未实机验收。

没有修改应用代码、构建、安装或改版本。结束时只读扫描未知项 0：`target` 30,010,795,065 B / 75,457 文件，非 scratch `.cache` 355,458,670 B，task scratch 1,136,632,367 B / 34,919 文件；E 盘可用 15,808,237,568 B，低于 20 GiB 提示线。相对上轮扫描的变化不归因于本轮；没有清理缓存或重试此前被策略拒绝的隔离 profile 清理。
