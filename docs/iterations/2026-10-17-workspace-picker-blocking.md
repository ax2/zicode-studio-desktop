# 工作区文件夹选择器阻塞隔离（2026-10-17）

## 发现与修改

`open_folder_as_workspace` 是 Tauri 异步命令，但原先直接调用系统 `blocking_pick_folder`。用户通过桌面入口切换项目时，等待系统选择器会占用异步运行线程。现按本项目 `project_file_picker` 和插件管理命令已采用的模式，仅把系统选择器放进 `tauri::async_runtime::spawn_blocking`；选中后仍在原窗口上下文执行既有的 tools-only/普通项目切换逻辑，取消仍返回 `None`。没有改变工作区身份、插件执行或文件读取授权。

## 验证

`bun run check:rust:static` 退出 0，Cargo check 与严格 Clippy 通过；rustfmt 继续提示仓库现存格式漂移。当前只有用户正在使用的已安装版窗口可选中，执行路径与本工作树 Debug EXE 不同。本轮没有干扰该会话、安装新版本或用其画面冒充本次补丁验收；没有保存截图。原生项目选择器实际交互、托盘实体点击和 Explorer 多选菜单仍待隔离验收。

这是线程占用修正，不证明系统选择器自身不会卡住，也不替代完整 ZiFile 插件功能或 DevTools 全目录验收。没有更改 DevTools、ZiFile、应用版本或打包配置；未生成新的完整运行目录或 ZIP。

前后只读空间扫描完整、未知项均为 0：target 均为 29,421,211,561 B，task-scratch 均为 932,850,915 B；E 盘可用 36,979,863,552 → 36,849,160,192 B。本轮未清理文件，卷余量变化不能归因于这次修改。
