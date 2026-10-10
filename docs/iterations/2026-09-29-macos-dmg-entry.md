# 2026-09-29 macOS DMG 入口收敛

状态：脚本静态修改完成；macOS 真实构建与安装尚未验收。

## 发现

- `release:mac:dmg` 使用 `release-macos-dmg.sh`，原脚本手动准备 Pi 与扩展，再调用全局 `tauri build --bundles dmg`。
- 仓库实际通过项目内 Tauri CLI 和 `scripts/build-desktop.js` 构建；该入口为 Cargo 补齐路径，并在 macOS 选择 DMG。Tauri `beforeBuildCommand` 已准备运行时、资源和前端。原脚本的全局 CLI 假设与重复准备增加了跨机器失败和构建耗时。
- 原脚本以最新时间选择现有 DMG；没有本次构建产物时，可能报告旧文件。

## 修改

- macOS 脚本改为调用仓库的 `bun run build`，复用项目内 CLI、Cargo 路径和完整构建前置流程。
- 构建开始前创建时间标记，只接受本次构建后产生的 DMG。兼容默认 Cargo target 目录和绝对或相对 `CARGO_TARGET_DIR`；相对路径同时检查仓库根与 `src-tauri` 下的解析结果。
- `.gitattributes` 固定该脚本为 LF，避免 Windows 工作区中的混合换行进入 macOS 可执行脚本。
- 没有生成 ZIP，也没有修改 Windows/Linux 打包目标。

## 验证与遗留

- 使用仓库内 Portable Git 的 Bash 做 `bash -n` 语法检查，通过；脚本当前 CRLF 数为 0，Git `eol=lf` 与差异空白检查通过。没有在 Windows 上伪装运行 macOS 打包，更没有 Mac 实机结果。
- 随后移除了 `package.json` 中与 Tauri `beforeBuildCommand` 重复的 `prebuild`：`bun run build` 和直接 `tauri build` 均由 Tauri 钩子完成资源与前端准备，避免同一次构建重复执行下载检查和编译。仅静态核对调用链，尚无 macOS 实机构建结果。
- 手动 DMG 入口现也识别 `CARGO_BUILD_TARGET` 对应的 `target/<triple>/release/bundle/dmg`；要求 Rust 目标和可选的 `PI_TARGET_PLATFORM` 都与当前 Mac 架构一致，避免内嵌 Pi/Bun 与 DMG 架构不一致。仍需实际 Mac 构建验证路径。
- macOS 应用启动、签名、DMG 安装和卸载仍需真实机器验收。
