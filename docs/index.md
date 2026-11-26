# ZiCode Studio Desktop

ZiCode Studio Desktop 是面向浏览、AI 协作、知识沉淀与发布的个人工作台。Windows 是默认构建和发布平台，随安装包提供锁定版本的 Pi、Bun、PortableGit 和 WebView2 离线安装器。项目独立维护，保留参考 Picot 的历史与原许可证。

## 当前入口

- 产品范围与整改顺序见 [项目路线图](../ROADMAP.md)。
- 实时需求、版本、责任与验收见 [GitHub Project #4](https://github.com/users/ax2/projects/4)。
- Windows 正式安装包与已知问题见 [公开发布](https://github.com/ax2/zicode-studio-desktop/releases/latest)。
- 项目术语见 [CONTEXT.md](../CONTEXT.md)。

## 功能与架构

- 浏览器、Pi 对话、笔记与博客是一级内置应用。邮箱与视觉资产中心为独立内置工作台。
- [架构方案](architecture.md)与[架构决策](adr/)记录产品、宿主和资源隔离。
- [插件平台](plugins/overview.md)和[独立工具获取](plugins/devtools-public-delivery.md)记录插件权限、安装和证据。
- [Windows 打包](windows-packaging.md)和[更新实现](../AUTO_UPDATER.md)记录发布方式。当前公开 Windows 安装包暂未使用 Authenticode。
- 应用帮助页由 `public/help/` 提供。

## 历史证据

[历史实现记录](implementation-status.md)、[开发回执](iterations/)和[发行输入](releases/)保留原版本、范围与验收。新进展写入对应 Issue 和版本回执。
