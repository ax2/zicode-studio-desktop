# 2026-09-29 外部打开操作边界

状态：Windows 本地编译与 Clippy 检查通过；远程与三平台实机行为待验收。

## 目标与发现

- Host 的 `open_in_app` 原本直接接受前端提交的路径、应用名或命令；远程客户端操作禁用表没有覆盖该入口。已配对远程客户端可以提交任意命令给桌面 Host 执行。
- `open_external` 也未禁止远程客户端调用；Windows 实现还通过 `cmd /C start` 打开 URL，URL 会进入命令解释器。
- 正常桌面入口只需要打开已登记工作区，目标来自 Host 返回的外部应用列表。外链使用 HTTP(S) 或邮件链接。

## 修改与决定

- `list_installed_apps`、`open_in_app` 和 `open_external` 均列为远程客户端不可调用的 Host 操作。
- `open_in_app` 在启动前规范化请求路径，要求它恰好对应当前登记的某个工作区根目录，并要求提交的应用名与命令组合存在于 Host 当前发现的目标列表。
- `open_external` 仅接受可解析的 HTTP、HTTPS 或 mailto URL；Windows 改用 `ShellExecuteW` 调用系统默认处理器，不再经 `cmd.exe` 解析 URL。macOS/Linux 继续使用系统 `open`/`xdg-open`，传入规范化 URL。
- 不改变桌面外部应用 UI 协议；请求中仍包含路径和目标，但 Host 不再信任这些值。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked` 通过；`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings` 通过。
- 本轮未新增或运行测试，未使用真实远程客户端、浏览器、文件管理器或 macOS/Linux 机器验收。
- 远程禁用表和 Host 校验是两层静态约束；还需真实协议与安装包验证。请求时目标存在不保证调用瞬间应用仍可启动，失败会沿原有错误通道返回。

## 接续：Host 操作远程默认拒绝

- 对照当前 `dispatch_host_operation` 的全部分支，已实现的 Host 操作都触及本机状态或本机安装信息；此前的逐项远程禁用表唯一漏下 `list_pi_packages`，未来新增操作也可能再次遗漏。
- Router 现在对远程客户端的整个 `host_request` 命名空间默认拒绝。桌面客户端仍按现有分发器处理；远程客户端的 `data_request` 与受控 `runtime_request` 路径不受此改动影响。
- `websocket_session` 已要求非回环连接以 `remote` 类型完成设备令牌认证，Router 的默认拒绝作用于这一客户端类型。回环客户端的桌面身份边界仍需独立审查。
- 本轮未运行测试或远程实机协议验证；需在真实移动端确认预期功能未依赖 Pi 包列表 Host 操作。
