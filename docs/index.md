# ZiCode Studio Desktop

ZiCode Studio Desktop 是一个面向 Windows 10/11 的本地 Pi 桌面应用。最终用户只安装一个经过签名的安装包，不需要预装 Pi、Node.js、Git、Bash、Rust 或 WSL。

项目以 Picot `v0.3.1-beta.13` 的 MIT 代码为工程基线，保留其 Tauri、Rust Host、Pi RPC、会话管理和自动更新能力，并针对正式 Windows 产品补齐依赖、场景、隔离、安全和发布链路。

当前实现进度和验证证据见[实现状态](implementation-status.md)。

## 当前目标

- Tauri 2 桌面壳和 Rust 进程管理。
- 内置、版本锁定的 Pi Runtime。
- 内置 Portable Git Bash；扩展能力需要时提供受控 Node/npm Runtime。
- 自定义模型渠道，包括 `base_url`、协议、Headers、模型目录和连接测试。
- 金融、编程、创作及用户自定义场景。
- 每个实例独立的进程、配置、会话、扩展、日志、临时目录和权限策略。
- Release tag 自动构建 Windows NSIS EXE 安装包。
- MkDocs 文档构建和可下载文档站产物。

## 文档入口

- [产品需求](requirements.md)
- [架构方案](architecture.md)
- [场景与实例隔离](scenes-and-isolation.md)
- [Windows 打包](windows-packaging.md)
- [实施计划](implementation-plan.md)
- [实现状态](implementation-status.md)
- [方案 Review](reviews/2026-07-30-solution-review.md)

## 证据原则

历史和完成状态只按源码、构建产物、自动化测试和安装验证记录。尚未完成或尚未验证的能力明确标记为“计划中”或“待验证”。
