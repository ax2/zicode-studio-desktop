# Windows Debug 关闭与单实例恢复实机复核（2026-10-18）

## 目标与环境

复核现有 Debug EXE 的关闭到后台及再次启动恢复主窗口。程序为 `target/debug/zicode-studio-desktop.exe`，SHA-256 `3C1B68AB17A6D7C658BA1181DAA1EF7129D065F584A2F6303C3E3A9D79E32976`。该 EXE 的构建时间早于当前未提交源码修改，因此本记录只证明这份二进制的行为。

Computer Use 首次用裸 `.exe` 路径启动时，Windows 应用解析器返回了已安装版的进程路径；该窗口随即关闭，未作为 Debug 验收。改用明确的 `process:E:\zicode-studio-desktop\target\debug\zicode-studio-desktop.exe` 标识后，返回窗口的进程路径与目标 Debug EXE 一致。

## 操作和观察

1. 从返回的唯一 Debug 主窗口观察界面，按 Alt+F4；复查时主窗口从窗口清单消失，Debug 程序仍在运行。
2. 再按同一 Debug 进程路径启动；主窗口重新出现。只读进程清单显示一个 `zicode-studio-desktop.exe` 主进程，路径仍是项目 `target/debug`。
3. 结束观察时再次按 Alt+F4；复查主窗口已隐藏，Debug 进程仍在后台。未安装插件、改变安全权限、执行工具、写入项目文件或启动新构建。

## 验证边界

这证明 Windows Debug 的“主窗口关闭后后台继续运行 → 再次启动恢复窗口”链路；**不证明**物理托盘图标右键菜单、托盘左键、菜单中“显示/隐藏/退出”各项操作，也不证明 macOS/Linux 行为。Computer Use 当前只返回应用窗口，未返回可定位的系统托盘窗口，所以本轮没有以坐标猜测系统菜单。窗口恢复后显示了用户已有会话内容，故本轮不保存或传播该截图；没有界面代码修改。后续物理菜单验收需可靠的系统托盘交互入口和不含私有会话内容的隔离配置。
