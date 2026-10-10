# 2026-09-29 插件视图远程范围

状态：Windows 本地编译与静态检查通过；桌面和远程页面待验收。

## 目标与发现

- 开发者插件视图从 `/v2/plugin-views/source` 读取 HTML，并在沙箱 iframe 中运行。此前已配对远程设备仍可读取该源码。
- 上一轮已要求非内置插件的能力调用和 Worker 命令使用原生桌面令牌；远程页面再加载视图只会得到无法执行的操作。

## 修改与决定

- 视图源码端点列入桌面专属 HTTP 路由：回环请求必须带原生窗口令牌，公共远程入口直接拒绝。
- 远程插件视图宿主不请求源码、不创建 iframe，而在功能区显示桌面端可用说明。插件管理页继续提供只读目录。
- 更新现有 Host 视图请求夹具的令牌头；本轮未新增或运行测试。

## 验证与遗留

- `cargo check --manifest-path src-tauri/Cargo.toml --locked`、`cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`、Host rustfmt、相关 JS 的 Biome 与语法检查、差异空白检查通过。
- 已安装签名插件的视图宿主现有逻辑与开发者插件不同，后续需单独核对；三平台桌面视图与已配对远程页面仍待实际验收。
