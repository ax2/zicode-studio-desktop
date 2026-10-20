# 托盘退出的原生确认

2026-10-18，Studio 桌面壳。此前工作区窗口关闭会隐藏到托盘并保留 WebView，但托盘的“退出 ZiCode Studio”直接 `app.exit(0)`，不会保证触发 View 或工具中心的 `beforeunload`。用户可能在运行工具或结果尚未保存时退出。

## 修改

- 仅托盘的明确“退出”动作先弹 Tauri 原生确认，中文/英文跟随托盘语言。文案说明运行中的工具将停止、未保存结果可能丢失；“继续运行”取消退出，“退出 Studio”继续现有 `app.exit(0)` 路径。
- 对连续点击做单实例确认框保护；用户取消后恢复可再次选择退出。托盘隐藏/普通窗口关闭保留既有“隐藏并继续运行”行为。
- 不根据某个子系统的活动计数决定是否显示确认，避免遗漏模型、资源或后台任务。确认不是执行结果保存或跨重启恢复；Exit 事件仍使用原 Host 关闭屏障和受管 Pi 清理。

## 验证与遗留

- `bun run check:rust:static` 通过，整仓格式漂移继续作为既有 advisory；`desktop_tray.rs` 单文件 `rustfmt --check` 通过。
- 定向 Rust 用例 `exit_prompt_explains_running_work_in_both_languages` 1/1，通过中英文说明及两个操作标签检查。编译期间沿用项目 `target/debug`，没有生成发布包、ZIP 或版本号。
- 尚未在新版 Tauri 窗口对原生确认框截图、取消/确认两个点击路径及实际进程退出做验收。Computer Use 的当前启动接口只接收 EXE 标识，不能向本机 Debug EXE 传入独立 `--isolated-profile`；本轮没有改用日常配置进行替代验收。
- 当前 `target/debug/zicode-studio-desktop.exe` 为 125,213,696 B，SHA-256 `b41d837eaea2dd7305afb0594860e7c133746f33c72b44a62582a0d46b419a17`；本轮未用它宣称原生交互成功。
- 对话框本身不会保存任何工具结果；跨应用重启的未知调用仍需要持久化状态与处理合同。完整 DevTools 工具接受数保持 0/154；隔离 JSON 插件和 `pi.tools.register` 未改。

前后只读空间扫描完整、未知项均 0：`target` 30,030,243,488 B / 75,800 文件 → 30,030,550,875 B / 75,826 文件，逻辑增加 307,387 B；普通 `.cache` 355,458,670 B / 156、`task-scratch` 1,258,318,024 B / 35,572、`site` 29,644,753 B / 431 均未变。E 盘空闲 8,370,683,904 B → 8,424,312,832 B，卷变化不能归因于本轮。两次扫描退出 1 仅是容量 advisory，没有清理可复用缓存。

技术博客工作日志：`C:/Users/ax2/Documents/技术博客/zicode-studio-desktop/iterations/tray-exit-confirmation-2026-10-18/work-log.md`。
