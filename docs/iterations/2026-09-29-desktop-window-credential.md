# 2026-09-29 桌面窗口凭据

状态：Windows 本地编译与静态检查通过；原生窗口与浏览器实际行为待验收。

## 目标与发现

- WebSocket 在回环入口允许 `clientType=desktop`，先前只依靠 IP 与浏览器 `Origin` 判别。普通浏览器直接访问回环 Host 时也具有相同来源，因此不能证明它属于原生 Tauri 窗口。
- `resolveRemoteAuth` 此前把所有回环页面直接归类为桌面客户端。需要由原生窗口发放的凭据把桌面角色与普通浏览器区分开。

## 修改与决定

- Host 启动时生成随机桌面会话令牌，只保存在进程内；原生工作区 WebView 在文档脚本运行前注入该值。注入脚本核对顶层窗口与当前 Host 来源，避免把值放到其他网页。
- 桌面页面把该令牌放进 WebSocket `hello`；Host 对桌面类型逐次核对。其他页面若无令牌，即使连接来自回环地址也无法获得桌面 Router 权限。
- 普通回环浏览器页面不再自动归为桌面；若已有配对设备令牌则按远程设备连接，否则要求配对。
- 令牌不写入 URL、持久存储、文档或日志。既有 WebSocket 场景的夹具已随握手字段调整，本轮不新增或运行测试。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`、修改的 Host Rust 文件 rustfmt、前端改动模块 Biome、相关 JS 语法和差异空白检查通过。`main.rs` 与 `app.js` 整文件仍有现存格式漂移，本轮没有批量改动。
- 尚未在 Windows、macOS、Linux 原生 WebView 或普通浏览器中实际验收注入和重连。HTTP 入口仍保留无浏览器标记的本机原生兼容路径，尚未全面改为桌面会话令牌鉴权。
