# 自动化无窗口执行入口（2026-10-01）

## 目标与发现

当前桌面 Host 在主窗口启动时创建，最后一个窗口关闭后进程退出，自动化循环随之停止。自动化子代理通过本机 HTTP Broker 调用已授权插件工具，因此独立进程仍需要一个受限的回环接口。

## 修改与决策

- 新增显式命令行入口 `--zicode-automation-worker --public-dir <绝对路径>`。传入安装资源中的 `public` 目录；入口先校验目录、内嵌 Pi、Windows Portable Git 和已初始化的项目注册表，再创建 Tokio 运行时、Pi 管理器与 Host。它不创建 WebView。
- Host 增加 `AutomationWorker` 启动模式。该模式仍使用用户级执行锁和跨进程项目注册表刷新；仅在 `127.0.0.1` 上提供带运行时 Bearer 令牌校验的 `/v2/plugin-tools/invoke`，不提供桌面页面、其他数据 API、LAN、Relay 或公网服务。
- 收到 Ctrl+C（Unix 也支持 SIGTERM）后，先取消 Host 后台任务并等待退出屏障，再停止 Pi 子进程。强制结束进程时由操作系统释放执行锁，实际运行结果仍按现有孤儿任务规则处理。
- 当前入口是显式启动能力，尚未由桌面应用自动拉起，也未接入开机启动或托盘状态。后台进程与桌面进程可以并存，只有持锁者派发自动化。

手动调用形式：`ZiCode Studio Desktop[.exe] --zicode-automation-worker --public-dir <安装资源目录/public 的绝对路径>`。开发构建可传仓库 `public` 的绝对路径，并由调试模式寻找仓库内的 Pi 与 Portable Git 资源。

## 验证与遗留

`bun run check:rust:static` 退出 0，包含 Cargo check 和以警告为错误的 Clippy；仓库级格式检查仍报告已有格式漂移。新增 worker 文件、Host 文件与 Pi 资源解析文件经目标 `rustfmt --check` 通过。未运行测试、实际启动无窗口进程或三平台验收。Windows 发布包使用 GUI 子系统，命令行错误的可见日志与正常退出控制还需完善；插件工具真实调用、休眠唤醒和安装目录解析均待实机验证。

静态检查后执行 `cargo clean --manifest-path src-tauri/Cargo.toml`，Cargo 报告移除 18,936 个构建文件、约 3.2 GiB。

后续已补充无控制台时的显式停止命令、单实例锁与有界日志，见[进程控制日志](2026-10-01-automation-worker-control.md)。
