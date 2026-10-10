# 平台专属打包资源隔离（2026-09-28）

## 发现

Tauri 配置始终映射 `src-tauri/resources/portable-git` 和 `webview2`。两个下载脚本在非 Windows 目标只创建目录并跳过下载；若同一工作树以前构建过 Windows 版本，目录内约 389 MiB 的 Portable Git 和约 194 MiB 的 WebView2 安装包会继续存在，并可能进入 macOS/Linux 产物。独立 CI checkout 不受此残留影响，但本地跨系统复用工作树会受影响。

## 修改

- 非 Windows 目标运行资源准备脚本时，清除各自专用目录内的生成内容，保留已有 `.gitkeep` 占位文件。
- Windows 目标仍按版本锁下载、校验和安装资源；缓存压缩包不清除，切回 Windows 时可复用。

## 验证与限制

全局 `bun run check`、两脚本 Biome/Node 语法检查、离线严格 MkDocs 构建通过。没有在本机切换目标并运行资源脚本、运行测试或生成 macOS/Linux 安装包；最终包体积和运行行为仍需对应系统验收。
