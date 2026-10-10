# 2026-09-29 回环 HTTP 来源边界

状态：Windows 本地编译与静态检查通过；真实浏览器与远程设备待验收。

## 目标与发现

- 本机 HTTP Host 与 LAN Host 复用一个 Router。中间件此前对回环 TCP 地址直接放行，未区分桌面页面与本机浏览器打开的其他来源。
- 远程页面即使显示在同一台电脑，其访问 `127.0.0.1` 时的 TCP 地址仍是回环地址。浏览器请求的 `Origin` 或 `Sec-Fetch-Site` 可表明它不属于桌面页面。
- 配对二维码与本地模型网关的处理器仅检查回环 IP，必须防止跨来源页面借回环地址触达。

## 修改与决定

- 回环请求若带 `Origin`，必须与当前桌面来源完全一致；若带 `Sec-Fetch-Site`，仅接受 `same-origin` 或用户直接导航的 `none`。格式异常按跨来源处理。
- 跨来源回环请求需经过设备令牌验证；配对二维码与本地模型网关即使带令牌也保持桌面专属。
- 未带浏览器来源标记的本机原生调用保持兼容。浏览器若同时省略来源和 Fetch Metadata，服务端仍无法仅凭回环 IP 区分其身份；完整消除这一边界需要桌面会话级凭据及前端接入。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`、目标 Rust 文件的 rustfmt 检查与差异空白检查通过。
- 本轮未新增或运行测试。尚未在真实浏览器中验证各请求模式，也未验证已配对设备访问 LAN HTTP 的行为。
