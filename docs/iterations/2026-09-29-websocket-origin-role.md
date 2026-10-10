# 2026-09-29 WebSocket 来源与桌面身份边界

状态：Windows 本地编译与静态检查通过；真实浏览器与远程配对待验收。

## 目标与发现

- 回环 `/v2/ws` 的来源白名单同时包含桌面本机来源及已启用的 LAN、公共远程来源。
- 握手此前只根据连接 IP 和公共入口标志要求远程认证。本机浏览器打开远程页面时，连接回环 Host 的 IP 仍是回环地址；该页面若从白名单中的远程来源发起 WebSocket，可自报 `clientType=desktop`，绕过设备令牌校验。
- 无法解析的 `Origin` 此前按缺少 `Origin` 处理，在回环连接上也会通过来源检查。

## 修改与决定

- 回环入口仍先核对来源白名单；只要 `Origin` 与当前桌面本机来源不同，就要求握手以远程设备身份携带有效令牌。公共隧道入口继续始终要求远程认证。
- 带有无法解析的 `Origin` 直接拒绝；无 `Origin` 的回环本地客户端保持现有兼容行为。
- 这条边界针对浏览器来源和远程设备身份；本机原生进程可以省略或自行构造 `Origin`，不属于本轮变更覆盖的信任模型。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`、目标 Rust 文件的 rustfmt 检查与 `git diff --check` 均通过。
- 本轮未新增或运行测试；尚未使用真实浏览器分别检查桌面来源、LAN 来源、公共远程来源与已配对设备。
