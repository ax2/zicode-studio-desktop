# ZiCode Studio Desktop

ZiCode Studio Desktop 是一个面向项目、AI 协作、知识与自动化的跨平台个人开发者平台，内置版本锁定的 Pi Runtime。Windows 安装包包含 PortableGit 和 WebView2 离线安装器；macOS 和 Linux 使用系统 Git 与 Shell。

项目最初参考 Picot 封装 Pi 的桌面架构，没有直接 fork Picot，后续未持续跟进，当前独立维护。历史版权和 MIT 声明继续保留；完整背景见 [README 的来源说明](https://github.com/ax2/zicode-studio-desktop#项目来源与许可证)。

当前仍为早期开发版本：Windows 安装包尚未 Authenticode 签名，macOS 使用未公证的 ad-hoc 签名，签名自动更新尚未启用。

当前实现进度和验证证据见[实现状态](implementation-status.md)。

## 当前目标

- Tauri 2 桌面壳和 Rust 进程管理。
- 内置、版本锁定的 Pi Runtime。
- Windows 内置 Portable Git Bash；内置 Bun 支持受控扩展运行。
- 自定义模型渠道，包括 `base_url`、协议、Headers、模型目录和连接测试。
- 金融、编程、创作及用户自定义场景。
- 每个实例独立的进程、配置、会话、扩展、日志、临时目录和权限策略。
- 独立于 Pi Extension 的应用插件平台，包括主界面、工具栏、Capability 和权限管理。
- Release tag 自动构建 Windows NSIS EXE、两种 macOS 架构 DMG 和 Linux AppImage/DEB；全部平台及五资产门槛通过后公开。
- MkDocs 文档构建和可下载文档站产物。

## 文档入口

- [产品需求](requirements.md)
- [架构方案](architecture.md)
- [场景与实例隔离](scenes-and-isolation.md)
- [应用插件平台总览](plugins/overview.md)
- [内置插件与实施路线图](plugins/built-ins-and-roadmap.md)
- [金融工作台](finance-workbench.md)
- 应用内 Help 内容位于 `public/help/`，通过 Help 按钮打开。
- [Windows 打包](windows-packaging.md)
- [v0.4.2 验证与交付记录](releases/v0.4.2-verification.md)
- [实施计划](implementation-plan.md)
- [实现状态](implementation-status.md)
- [方案 Review](reviews/2026-07-30-solution-review.md)

## 证据原则

历史和完成状态只按源码、构建产物、自动化测试和安装验证记录。尚未完成或尚未验证的能力明确标记为“计划中”或“待验证”。
