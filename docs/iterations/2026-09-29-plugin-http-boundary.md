# 2026-09-29 插件 HTTP 权限边界

状态：Windows 本地编译与静态检查通过；远程真实调用待验收。

## 目标与发现

- WebSocket Router 已默认拒绝远程 `host_request`，但已配对设备的 HTTP 令牌此前可直接调用插件启停、授权、重载、卸载和命令入口。
- 命令入口启动本机插件 Worker；能力入口对开发者或签名插件也可能进入 Worker。仅有设备令牌不能代表桌面用户已授权更改插件权限或运行本机扩展代码。
- 内置能力是移动伴随访问的一部分，保持其既有令牌与能力 Broker 检查。

## 修改与决定

- 桌面同源 Host fetch 附加进程内窗口令牌；跨来源请求不附加。插件管理与命令路由在 HTTP 中间件要求回环连接及该令牌，公共隧道入口始终拒绝。
- 能力调用先识别插件来源：非内置插件必须带桌面窗口令牌；内置插件仍经原有能力 Broker 的场景、启用状态、输入校验和审计。
- Pi 运行时的 `/v2/plugin-tools/invoke` 继续使用独立的短期 Broker 令牌，不复用窗口令牌。
- 现有 Host HTTP 夹具已同步更新请求头；本轮未新增或运行测试。
- 插件管理页接收客户端身份；远程页面保留只读列表，禁用启停、授权、安装、卸载、回滚、撤销和重载操作，并显示桌面端提示。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`、Host rustfmt、`bun run typecheck`、改动前端文件的 Biome lint、相关 JS 语法与差异空白检查通过；`bun run build:react` 已更新页面产物。
- 已配对设备的内置能力、桌面管理与跨系统原生窗口仍待真实验收。其他通过 HTTP 的本机操作还需逐路由审查。
