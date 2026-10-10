# 2026-09-29 外部应用目标发现与路径兼容

状态：Windows 本地编译和静态检查通过；三平台原生打开行为待验收。

## 目标与发现

- 项目工作区可以通过 Host 的 `list_installed_apps` 与 `open_in_app` 选择外部编辑器或文件管理器。
- macOS 会检查应用目录；Windows/Linux 的目标列表此前无条件包含 VS Code、Cursor、WebStorm 和 Zed，即使对应命令不存在。用户选择后才收到启动失败。
- Windows 规范化工作区路径可能带有 `\\?\` 前缀。Pi 启动路径已处理该前缀，但外部应用打开路径尚未处理，部分文件管理器或编辑器可能无法识别。

## 修改与决定

- Windows/Linux 的命令目标现在只在绝对 PATH 目录中找到对应文件时列出；Unix 还检查执行权限。文件管理器保留为系统入口。
- `open_in_app` 在传给编辑器、终端或文件管理器前，复用已有的 Windows verbatim 路径转换；其他平台路径保持原样。
- 不运行探测命令，不修改宿主 PATH，也不扩大允许的外部应用列表。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings` 和目标文件 rustfmt 检查通过。
- 本轮未新增或运行测试；未启动真实 VS Code、Finder、Explorer 或 Linux 文件管理器。PATH 存在命令文件只能证明目标候选存在，不能替代真实启动验收。
- macOS/Linux 编译和三平台 UI 交互仍需独立证据；未发布产物。
