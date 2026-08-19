# 内置插件与实施路线图

## 内置插件组合

### Chat（Core）

职责：

- 现有会话树、消息、Composer、上下文和工具卡；
- 作为默认 Activity 和 Main View；
- 展示其他插件提供、并允许对话调用的 Capability；
- 在插件 Main View 激活时保留运行状态和待审批 Badge。

Chat 不可禁用、卸载或被第三方插件覆盖 Command ID。

### Notes

目标是“本地优先、Markdown 可读、Astro 可发布”，同时为未来同步、多端和独立客户端
保留稳定数据模型。

功能：

- 新建多个 Notebook、文件夹、标签和 Markdown Note；
- 从 URL 获取网页，执行正文提取、元数据保留和 HTML → Markdown；
- 保存来源 URL、作者、发布时间、剪藏时间、内容哈希和引用片段；
- Command Palette 和快捷键提供“剪藏网页”，Sidebar 提供笔记本/标签/最近内容；
- Main View 提供编辑、预览、反向链接和搜索；
- Chat/Pi 使用 `notes_search`、`notes_get`、`notes_create` 等最小工具；
- 写入和覆盖必须携带版本号，避免模型覆盖用户并发编辑。

数据布局：

```text
plugin-data\<notes-key>\
├── vaults\<vault-id>\
│   ├── astro.config.mjs
│   ├── package.json
│   ├── src\
│   │   ├── content.config.ts
│   │   ├── content\
│   │   │   └── notes\
│   │   │       └── <note-id>.md
│   │   ├── pages\
│   │   └── layouts\
│   ├── public\attachments\
│   └── .zicode\
│       ├── vault.json
│       └── index.sqlite3
└── settings.json
```

Markdown + Frontmatter 是内容真相，SQLite 只是可重建索引。`note-id` 是稳定 UUID，路径
重命名不改变身份。Frontmatter 最少包含：

```yaml
---
id: "opaque-uuid"
title: "Example"
createdAt: "2026-07-31T00:00:00Z"
updatedAt: "2026-07-31T00:00:00Z"
tags: []
source:
  url: "https://example.com"
  capturedAt: "2026-07-31T00:00:00Z"
  contentHash: "sha256:..."
---
```

Astro 是本地博客结构和发布适配层，不应成为读取或编辑笔记的硬依赖。第一版可以维护
Astro Content Collection 兼容目录并由内置预览器展示；在打包受控 Astro/Bun Runtime
前，不承诺离线执行任意第三方 Astro Integration。

同步路线：

1. 本地 Vault 和稳定 ID；
2. 增量变更日志、内容哈希和 Tombstone；
3. 可插拔 Sync Provider；
4. 端到端加密密钥设计；
5. 移动端/独立客户端共享数据协议。

### Finance

迁移现有 Finance Workbench，而不是重写确定性逻辑：

- Activity：Finance；
- Sidebar Views：观察列表、研究任务、模拟账户；
- Main Views：市场、选股、回测、模拟交易；
- Command Palette 与 Finance View 局部动作：刷新数据、添加观察、运行筛选；
- Capabilities：行情发现、回测、筛选和模拟账户查询；
- Pi Tools：保留当前 QVeris、确定性回测和账本工具；
- 权限：按 Finance Scene 的网络白名单、费用确认和 Shell 禁用策略执行。

当前 Finance 已通过内置 Contribution 进入统一三栏 Shell，原浮层入口保持隐藏且不再
作为用户入口；`picot-config` 操作、QVeris 场景隔离、确定性分析和模拟账本行为保持兼容。

### Artifacts（已内置）

集中管理 Agent 和插件生成的报告、图表、文件、导出与来源信息：

- Activity、功能区和主视图均已接入统一 Shell；
- 主界面提供搜索、类型与来源筛选、内容、来源、导出和版本化删除；
- Chat、Finance、Notes 共用资源句柄，避免把大对象复制进消息；
- 后续支持可复现报告和发布。

### Tasks & Automations（建议内置，后续）

把跨会话待办、定时/事件触发和长期任务从 Chat 历史中分离：

- 明确显示触发器、下一次运行、使用模型和费用上限；
- 后台执行需要独立于 WebView 的 Host Runner，不能在第一阶段用隐藏 iframe 冒充；
- 任何自动 Prompt、网络发布或文件写入都需要单独权限和审计。

当前状态（2026-08-19）：Tasks 与 Automation 与 Projects 一起默认禁用
（`enabledByDefault=false`），代码与数据保留；待后台 Host Runner 与项目
CRUD 完成后重新启用。

### Research Library（建议后续合并评估）

网页、PDF、数据集和引用的统一资料库。第一版先作为 Notes 的“资料”View，只有在数据
模型和使用方式明显独立后再拆成插件，避免过早形成两个搜索索引。

## 分阶段实施

### Stage P0：契约冻结与原型

- 接受 ADR 0005；
- 冻结 Manifest v1、Contribution ID、权限目录和错误码；
- 用静态原型验证 Activity Bar、Accordion Sidebar、Main View Router 和 Command
  Palette；
- 以 Chat、最小 Command 示例、Notes 壳为三组契约样例；
- Threat Model Review。

验收：设计评审逐项覆盖用户的八项需求；原型验证桌面和窄窗口导航，不接入真实用户数据。

### Stage P1：Registry 与 Plugin Manager

- Rust `PluginRegistry`、包目录、Manifest Validator；
- 内置插件注册；
- 按 Scene 启用/禁用、权限持久化；
- Plugin Manager 的 Installed/Built-in/Developer 页面；
- 安装、禁用、卸载保留数据的单元与集成测试。

验收：无运行时代码也能管理 Contribution 元数据；路径逃逸和损坏 Manifest fail
closed。

当前进度（2026-07-31）：Rust Registry、内置/Developer Manifest 发现与校验、按
Scene 启停和权限持久化、Host HTTP API、Manager 来源/权限/诊断界面已实现并通过
Rust、前端和浏览器回归。本地目录选择、staging/backup 原子安装与同 ID 升级、刷新、
卸载保留源目录/状态/数据也已实现。签名清单和仓库分发属于 P7；P1 的本地 Developer
生命周期验收已完成。

### Stage P2：Shell 与 Chat Core Plugin

- Activity Bar、Accordion Sidebar、Command Palette；
- Main View Router、路由恢复、`canDeactivate`；
- 将现有 Chat DOM 包装为 `core.chat`；
- 命令面板和菜单统一引用 Command Registry；
- 无障碍和响应式测试。

验收：Chat 与示例 Main View 无刷新切换；Chat 草稿、Session 和滚动位置保留；非活动
Main View 不可聚焦。

### Stage P3：SDK、隔离 View 与后台 Runtime

- 已完成 Developer View 资源校验、opaque iframe、限制性 CSP 和消息来源校验；
- 已完成 View Context、Dirty 状态、通知、Own Command 和 Own Capability API；
- 已完成 Developer JavaScript Worker 独立隐藏子进程、Capability/Command 注册、
  5 秒超时和进程终止；
- Storage API、异步取消、长驻激活和熔断仍在实施；
- Developer Mode、Reload、DevTools 和诊断；
- View 消息限制为 64 KiB 和每实例 32 个活动请求。

当前验收：`examples/plugins/view-demo` 已在真实 WebView2 桌面壳中验证三栏显示、
Context、通知和 View→Host→Worker Capability；sandbox 没有 `allow-same-origin`，
CSP 禁止直接网络、表单、Worker、子框架和顶层资源。Developer Worker 没有 DOM、
网络、文件、环境变量和进程 API，超时会终止独立进程；公开第三方信任仍等待 P7 WASI。

### Stage P4：Pi Broker 与 Chat Capability

- 新增独立的 `zicode-plugin-broker` bundled Pi Extension；
- Rust Capability Registry 与每 Runtime 短期 Token；
- Chat 调用插件 Capability；
- Pi Tool Schema 快照、转发、审计、幂等和取消；
- Scene 切换时撤销旧工具和 Token。

验收：Pi 可调用示例 Tool；权限撤销后立即不可见；不加载插件自带任意 Pi Extension；
付费 Prompt 不可静默触发。

### Stage P5：Notes

- Vault/Notebook/Note 数据模型；
- Markdown + Astro Content Collection 兼容目录；
- 编辑器、预览、搜索和附件；
- 网页正文提取、来源元数据、重复内容检测；
- Chat/Pi Capability；
- 导入、导出、备份和损坏索引重建。

验收：关闭应用后 Markdown 可用普通编辑器读取；删除插件默认保留 Vault；网页剪藏不
保存 Cookie/Authorization；索引可从 Markdown 全量重建。

实现状态（2026-07-31）：上述 P5 范围已落地并通过 Rust、前端和桌面界面测试；附件、
Markdown 导入、含附件的可读备份、显式索引重建、受控 Astro 本地构建和增量变更协议
已包含。云端同步适配器仍受端到端加密与冲突协议门禁。

### Stage P6：Finance 迁移与 Artifacts

- 将现有 Finance UI 和服务注册为内置插件 Contribution；
- 保留 QVeris Key 场景隔离、费用确认、确定性回测和模拟账本；
- 增加 Artifacts 资源句柄与统一结果库；
- 删除旧硬编码入口前完成行为对照测试。

验收：现有 Finance 测试与 Smoke Test 继续通过；插件禁用不破坏数据；Finance Scene
限制不因插件化放宽。

实现状态（2026-07-31）：Finance 已迁入统一三栏应用，仍复用现有 QVeris、回测、筛选
和模拟账本服务；市场快照、回测和筛选结果以 best-effort 方式写入 Artifacts。Artifacts
Host Store、场景/权限/来源插件检查、不含路径的资源句柄、搜索筛选、查看、可读导出和
乐观删除已实现。普通插件界面不再展示 P5/P6 内部阶段标签。

### Stage P7：第三方分发与同步基础

- 已完成 `.zicode-plugin` 哈希清单、Ed25519 发布者签名、首次信任、撤销、原子更新和
  显式回滚；
- WASI 后台 Runtime 或等价 OS 级隔离方案；
- 插件仓库与更新渠道；
- Notes 增量日志和 Sync Provider 接口；
- 独立客户端共享协议草案。

验收：供应链和沙箱 Threat Model 通过后，才允许默认安装第三方插件。

## 依赖与非目标

关键依赖顺序：

```text
Manifest/Permissions
  → Registry/Manager
  → Shell/Router
  → SDK/Sandbox
  → Capability Broker
  → Pi Broker
  → Notes/Finance migration
  → Signed third-party ecosystem
```

首轮非目标：

- 未审核的原生 DLL/EXE 插件；
- 插件直接获得 Tauri IPC；
- 插件绕过 Scene Policy；
- Notes 第一版即提供云同步或独立客户端；
- Finance 接入真实券商或自动实盘交易；
- 在没有后台 Host Runner 时承诺无人值守 Automation。

## 八项需求覆盖

| 需求 | 设计证据 | 首个实现阶段 |
| --- | --- | --- |
| 左侧插件 UI | Activity Bar + Accordion Sidebar | P2 |
| 对话调用插件 | Capability Registry | P4 |
| 插件主界面替换对话 | Main View Router，Chat Core Plugin | P2 |
| 深入调用 Pi | 权限化 `zicode.pi` + Pi Tool Broker | P4 |
| 完善开发文档 | Manifest、Host API、安全、开发指南 | P0 起持续 |
| 顶部工具栏/菜单入口 | 已按 2026-07-31 决策取消；改用 Command Palette、快捷键和局部动作 | P2 |
| 插件管理 | Registry + Plugin Manager | P1 |
| 内置 Notes、Finance 等 | Notes、Finance、Artifacts、Tasks | P5–P7 |
