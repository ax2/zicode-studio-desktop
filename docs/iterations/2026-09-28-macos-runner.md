# macOS runner 迁移（2026-09-28）

## 发现

开发平台检查与 Release 构建均使用 `macos-14`。核对 GitHub 官方 [runner 镜像表](https://github.com/actions/runner-images#available-images) 后，确认这个标签为 ARM64，与 `darwin-arm64` 目标匹配，但 macOS 14 镜像已被标记为 deprecated；[镜像公告](https://github.com/actions/runner-images/issues/13518)计划于 2026-11-02 完全停止支持。

## 修改

- 开发平台检查矩阵与 Release 的 Apple Silicon DMG job 改用 `macos-15`。官方镜像表将该标签列为 ARM64；现有 `check-release-target.mjs` 继续核对运行器进程架构和 Rust host triple。
- 平台验证文档同步更新检查目标，保留 Windows 2022 和 Ubuntu 22.04 当前配置。

## 验证与限制

静态 YAML 解析、`bun run check`、离线 MkDocs 严格构建和 `git diff --check` 均通过。本轮未触发 CI、测试或发布；macOS 15 实际依赖安装、Tauri 构建与运行行为仍需对应 runner 证据。
