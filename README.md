# ZiCode Studio Desktop

ZiCode Studio Desktop 是一款以 Windows 为首要交付平台的本地优先开发者桌面应用。它把浏览器、笔记、视觉资产、AI 协作和开发工具放在同一个工作台中，使用 Tauri 2、Rust Host、React 和内嵌 [Pi](https://github.com/earendil-works/pi)。macOS 和 Linux 保留长期支持方向，默认不构建或验收。

## 下载与安装

在 [GitHub Releases](https://github.com/ax2/zicode-studio-desktop/releases/latest) 下载 Windows 10/11 x64 的 NSIS `.exe` 安装包。默认只构建和发布 Windows；只有明确要求时才构建其它平台。历史 macOS/Linux 包可从 [全部 Releases](https://github.com/ax2/zicode-studio-desktop/releases) 查找，不代表具备当前源码的全部功能。

Windows 安装包内置 Pi、Bun、PortableGit（Git 与 Bash）和 WebView2 离线安装器。无需另行安装 Pi。下文说明以当前源码为准，已发布功能及限制请查看所安装版本的发布说明；草稿 Release 不代表已经发布。

通过 GitHub 安装包升级，保留原资料目录。签名自动更新尚未启用；「设置 → 软件更新」提供手动获取新版的入口。

在 Studio 的「设置 → 软件更新」中可查看当前安装的 **Pi 版本**和 **Studio 版本**。

| 使用方式 | 内嵌 Pi |
| --- | --- |
| 从当前源码构建 | [Pi 1.5.2](https://github.com/earendil-works/pi/releases/tag/v1.5.2)（[源码版本锁](scripts/pi-version.json)） |
| 已安装的 GitHub Release | 以应用内显示及对应发布标签的 `scripts/pi-version.json` 为准 |

2026-11-18 已核对官方稳定 Release 与 SDK registry，最新稳定版均为 **1.5.2**，与本仓库的版本和摘要锁一致。[本次核对与复用的兼容证据](docs/iterations/2026-11-18-pi-stable-audit.md)

## 开始使用

1. Windows 默认打开浏览器。可在浏览器设置中改为启动时打开工作台。
2. 用左侧入口打开笔记、视觉资产、工具或 AI 会话。快捷工具、工具中心的浏览/搜索和 Windows 托盘提供工具直达入口；翻译也可从托盘打开。
3. 使用 AI 前，在设置中配置模型渠道及一个或多个模型。浏览器的「读取页面」面板可选择「浏览器模型」，默认「跟随 Pi」；也可为浏览器独立选择模型，不改写 Chat 默认。只有点击「发送网页并提问/总结」才发送已查看的快照，原有对话草稿入口保留。
4. 从左侧「视觉资产」打开图库。在生图/换装的「图像模型设置」中保留手动端点和本地服务配置，也可保存多个命名模型并切换。保存或切换不生成图片，实际提交仍需确认。[模块模型用法与边界](docs/module-model-routing.md)

## 主要功能

- **浏览器** · Windows 使用独立的 WebView2 网页视图。支持多标签、地址栏搜索、书签与 HTML 导入导出、历史、下载、页面查找、缩放和会话恢复。macOS 和 Linux 的内置网页引擎仍待交付。[浏览器需求与验收](docs/browser/requirements.md)
- **笔记** · 通过笔记本整理 Markdown 笔记、附件和网页剪藏。剪藏保留来源网址，笔记存放在工作区。加密云同步仍在开发。[笔记同步进度](docs/iterations/2026-11-04-notes-vault-sync.md)
- **AI 协作** · 使用内嵌 Pi 管理对话和工具调用，支持自定义模型渠道、API 地址和协议。可以先审阅网页正文、选区和多标签内容，再放入对话草稿。浏览器可独立选择 Pi 注册表中的模型；视觉图像服务保留单独配置与凭据，不凭模型名称推断生图能力。浏览器所选模型不可用时会报错，不悄悄回退到其它模型。Agent Inbox 支持飞书和企业微信智能机器人的官方长连接。
- **工具与桌面入口** · 常用工具可从快捷工具、可搜索的工具中心和 Windows 托盘直接打开。支持文字翻译、Windows 资源管理器文件/文件夹入口、本机文件多选，以及经确认后的原文件工具接力、校验和另存；插件不会因打开入口就自动读取文件。ZiDevTools 逐项接入和验收范围以清单为准。[ZiDevTools 接入清单](docs/plugins/devtools-all-tools.md)
- **工作台** · 默认工作区提供会话、文件、任务、终端和产物管理。日常界面使用简化导航，内部保留工作区、会话和权限边界。

视觉资产中心是长期核心模块。左侧“视觉资产”入口可打开本地图库、导入和预览图片；生图、换装及已保存的图像模型使用各自的参数与确认流程，切换模型保留现有图片和任务。角色、文稿模型审核等高级流程仍按开发记录逐项验收，不能将单项可用等同于全部规划完成。[视觉资产中心开发记录](docs/visual-assets/development.md)

## 数据与凭据

应用数据保存在独立于安装包和版本号的位置。Windows 默认运行资料位于 `%LOCALAPPDATA%\zicode`，系统资料位于 `%USERPROFILE%\.zicode`，笔记和附件位于工作区的 `.zicode\notes`。升级后继续使用原配置和工作区。开发验证可传入 `--isolated-profile <绝对路径>`，普通隔离模式禁用系统模型凭据。长期测试需显式追加 `--test-profile <名称>` 才启用该目录和名称专属的凭据域，不回退到日常或其它测试资料。[隔离与命名测试资料](docs/desktop-isolated-profile.md) · [固定数据目录与升级](docs/desktop-persistent-data.md)

备份时保留工作区及配置目录。只复制安装包或 EXE 不会备份笔记。

模型凭据通过 Rust Credential Broker 和系统凭据库管理；选择模块模型只保存引用，不把密钥复制进浏览器配置。Pi 的会话、日志和临时目录按运行实例隔离。[数据与进程架构](docs/architecture.md)

## 架构

```text
Studio Shell（Tauri + React）
  ├─ 浏览器界面 → Rust 浏览器模块 → Windows WebView2 网页视图
  ├─ 笔记、产物、工具 → Rust Host → 本地数据库与文件
  └─ AI 会话 → Rust Host → 内嵌 Pi（JSONL RPC）
```

Rust Host 管理窗口、资料、权限、插件能力与 Pi 生命周期。网页视图通过浏览器模块呈现，Studio 的 Tauri 命令由可信界面调用。[架构文档](docs/architecture.md) · [浏览器引擎边界](docs/adr/0007-browser-engine-boundary.md)

## 本地开发

使用 Bun 和 Rust stable，并安装对应平台的 [Tauri 构建依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需要 Visual Studio Build Tools 的「使用 C++ 的桌面开发」组件，详见 [Windows 构建与打包](docs/windows-packaging.md)。

```text
git clone https://github.com/ax2/zicode-studio-desktop.git
cd zicode-studio-desktop
bun install --frozen-lockfile
bun run dev
```

`bun run dev` 准备当前平台的运行时和前端资源。需要独立调试 EXE 时使用 `bun run build:local`，产物位于 `target/debug`。正式 Windows 安装包使用 `bun run build`，NSIS 产物位于 `target/release/bundle/nsis/`。

```text
bun run check
bun run test
bun run check:rust:static
```

### 更新内嵌 Pi

先在 [Pi Releases](https://github.com/earendil-works/pi/releases/latest) 和官方 [SDK registry](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest) 确认目标稳定版；若当前已是同一稳定版且摘要一致，记录核对结果并复用范围匹配的证据，不重复下载/构建。需要升级时，将 `VERSION` 替换为版本号（不带 `v`）。版本锁记录上游发布的六个目标平台和架构的 SHA-256 摘要；内嵌二进制与扩展 SDK 必须使用同一版本。

```text
bun run update:pi:lock -- VERSION
bun add -d -E @earendil-works/pi-coding-agent@VERSION @earendil-works/pi-tui@VERSION
bun run check:pi-sdk-alignment
bun run typecheck:extensions-source
bun run build:extensions
bun run fetch:pi
```

只在版本变化时用 `bun run smoke:pi-rpc:update` 生成新版本的 [RPC 契约](tests/fixtures/pi-rpc)，与前一版本对照，确认命令、状态字段和事件仍兼容，再运行 `bun run smoke:pi-rpc`。这项测试使用隔离目录，验证二进制版本、命令发现和扩展执行。将需要桌面操作的项目汇总到主会话统一验收；不要为了文档改动启动桌面或重建同版。提交 `scripts/pi-version.json`、`package.json`、`bun.lock` 与新契约；下载的二进制不入库。[维护说明](AGENTS.md#bumping-the-embedded-pi-version)

继续以 Pi 作为 Agent 核心。DSH 等替代方案只在有可复现收益、兼容和迁移证据后另行决策，不随依赖维护自动替换。

### 发布

正式发布使用 `bun run release VERSION`。发布脚本在干净的发布工作树校验版本并推送标签。[GitHub Actions 发布流程](.github/workflows/release.yml)默认只构建并核对 Windows 安装包后发布 Release。仅在用户明确要求时手动选择 `all`，才构建 macOS 和 Linux；开发平台 CI 同样默认只检查 Windows。

## 文档与许可

- [项目文档](docs/index.md) · 产品计划、架构、开发与交付记录。
- [插件平台](docs/plugins/host-api.md) · Host 接口与权限范围。
- [桌面入口](docs/plugins/explorer-folder-entry.md) · Windows 资源管理器与工作区入口。

本项目最初参考 [Picot](https://github.com/shixin-guo/picot) 的 Pi 桌面封装思路，现独立维护。历史 `picot-*` 协议名和存储标识继续用于兼容已有扩展与资料。[MIT License](LICENSE) · [NOTICE](NOTICE) · [第三方声明](THIRD_PARTY_NOTICES.md)
