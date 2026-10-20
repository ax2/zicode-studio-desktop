# Pi 1.3.0 本地开发依赖更新（2026-10-16）

## 目标与范围

将 Studio 当前内嵌 Pi 从 1.2.0 更新到上游最新稳定版 1.3.0。Studio 应用版本保持 0.4.2；本次不发布应用版本、不构建 Release、不执行 Cargo 缓存清理。仅 Windows x64 运行时在本机实际替换；其他平台只更新上游发布锁与 SHA-256，尚未下载或运行验证。

## 修改

- `scripts/pi-version.json` 更新到 1.3.0，六个平台的摘要来自 GitHub Release API 中的发布资产 digest。
- `src-tauri/resources/pi/` 的当前 Windows x64 运行时被更新脚本原位替换；`.version` 标记为 `windows-x64`，摘要为 `daf0ef45fd08f13dbb64c62d559e332c2d3d3087f8ae022ec5a1b9b655b59894`。
- `tests/fixtures/pi-rpc/1.3.0/contract.json` 由项目脚本生成，保留版本化 RPC 契约证据。
- 下载归档保留在 `.cache/pi-binaries/1.3.0-pi-windows-x64.zip`（45,105,409 B）。先前 1.2.0 归档（45,099,534 B）和既有 `probe.bin` 仍保留；没有执行缓存清理。

## 验证证据

- 上游发布页显示 v1.3.0 于 2026-10-15 发布，且标记为 Latest：<https://github.com/earendil-works/pi/releases/tag/v1.3.0>。
- `bun run update:pi` 成功；脚本报告 `1.2.0 -> 1.3.0`，检查六个平台均具备 SHA-256 digest。
- Windows x64 发布压缩包摘要校验通过，运行时解包并安装成功。
- `src-tauri/resources/pi/pi.exe --version` 输出 `1.3.0`。
- Pi RPC smoke 两次各通过 6 个命令；一次更新/生成契约，一次使用契约复验。

## 结论与边界

本机 Windows x64 的 Pi 1.3.0 更新和 RPC 冒烟已验证。macOS、Linux、Windows ARM64 只有上游摘要锁定，没有相应设备上的下载、启动、RPC 或打包验证。应用 GUI、真实模型调用及完整项目验证不属于本轮。Studio 版本号仍为 0.4.2。