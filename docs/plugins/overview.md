# 应用插件平台总览

## 目标

ZiCode 应用插件是桌面程序本身的扩展能力，不是 Pi Extension 的别名。它统一扩展以下
产品表面：

- 左侧 Activity Bar 和风琴式 Sidebar View；
- 可完全替换聊天区域的插件主界面；
- 命令面板、快捷键和插件界面内的局部动作；
- 可由 Chat、Pi 或其他获授权插件调用的后台能力；
- 设置项、插件数据、密钥引用和审计事件；
- 安装、启用、禁用、更新、权限调整和卸载。

当前实现状态：Activity/Shell、Rust Registry、隔离 View、Developer Worker、
Capability/Pi Broker、内置 Notes/Finance/Artifacts，以及本地签名包安装、发布者信任、
更新、回滚和撤销均已接通。公开插件仓库与 WASI 后台沙箱仍按路线图继续实现。

Chat 是内置、不可卸载的核心插件。用户切换到 Notes、Finance 等插件时，主区域只显示
该插件的界面；Chat 会话状态保留，但其 DOM 不参与当前布局和键盘焦点。

## 与 Pi Extension 的边界

| 能力 | 应用插件 | Pi Extension |
| --- | --- | --- |
| 生命周期 | 应用安装与启停 | 单个 Pi 进程加载 |
| UI | 主界面、Sidebar、Command Palette | Pi 请求的对话框/通知/自定义 UI |
| 数据 | 插件级、场景级受控目录 | Pi Agent/Session 目录 |
| 调用 Pi | 经权限化 Host API | Pi SDK 内部直接调用 |
| 被对话调用 | Capability 与 Pi Tool | Tool/Command |
| 管理入口 | Plugin Manager | Pi Packages / Extensions 设置 |
| 安全边界 | Rust Host 权限与代理 | Scene policy + Pi runtime |

一个应用插件可以声明 Pi Tool，但工具由统一的 `zicode-plugin-broker` Pi Extension
注册和转发。插件包不因此成为任意可执行的 Pi Extension。

## 组件

```text
┌──────────────────────── Application Shell ────────────────────────┐
│ Activity Bar │ Sidebar Views │ Main View │ Command Palette        │
│                       Plugin UI SDK / postMessage                  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ /v2/ws plugin_request
┌──────────────────────────────▼─────────────────────────────────────┐
│ Rust Plugin Host                                                   │
│ Registry │ Package Validator │ Permissions │ Data │ Secrets │ Audit │
│ Commands │ Capabilities │ Network Proxy │ Pi Tool Broker            │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ loopback + per-runtime token
┌──────────────────────────────▼─────────────────────────────────────┐
│ pi --mode rpc + bundled zicode-plugin-broker extension             │
└────────────────────────────────────────────────────────────────────┘
```

## 核心领域对象

### PluginPackage

一个经过校验、不可变的版本目录。包含 Manifest、UI 静态资产、后台入口和资源文件。

### PluginInstallation

某个插件 ID 的已安装版本、来源、签名状态和更新时间。安装是应用级的。

### PluginEnablement

插件是否在某个场景中启用，以及该场景授予的权限。内置 Chat 对所有场景强制启用。

### PluginContribution

Manifest 声明的 Activity、View、Command、Setting、Keybinding、Capability 和 Pi
Tool。Shell 只渲染声明且当前 `when` 条件成立的贡献。插件不向顶部工具栏或应用菜单
插入入口。

### PluginActivation

插件从已启用进入活跃状态。激活事件必须是声明式的，例如 `onView`、`onCommand`、
`onCapability`、`onPiTool`，不能依赖插件在 import 时修改全局状态。

## 目录布局

目录名称使用插件 ID 的 SHA-256，不直接使用 Manifest 中的字符串作为路径：

```text
%LOCALAPPDATA%\zicode\
├── plugins\
│   ├── registry.json
│   ├── developer\<plugin-id>\
│   ├── signed\<plugin-id>\
│   ├── signed-versions\<plugin-id>\<version>\
│   ├── signed-metadata\<plugin-id>.json
│   ├── signed-version-metadata\<plugin-id>\<version>.json
│   └── trust\publishers.json
├── plugin-state\
│   └── <plugin-key>\
│       ├── global.json
│       └── scenes\<scene-key>.json
├── plugin-data\
│   └── <plugin-key>\
│       ├── global\
│       └── scenes\<scene-key>\
├── plugin-cache\<plugin-key>\
└── audit\plugins\
```

密钥不能进入上述普通 JSON。Manifest 只能引用由 Secret Broker 返回的不透明
`secretRef`。

## 包格式与来源

支持顺序如下：

1. 内置插件：随应用签名和版本发布；
2. 开发目录：显式开启 Developer Mode 后加载，界面持续显示“完全信任本地代码”；
3. 本地 `.zicode-plugin` 包：逐文件 SHA-256、Ed25519 发布者签名、明确建立发布者信任；
4. 未来插件仓库：复用相同签名格式，并增加远程撤销与兼容性索引。

Windows 正式阶段交付仍保留完整可运行目录和 EXE；插件包是插件分发格式，不是程序阶段
版本的 ZIP 交付物。

## 状态与生命周期

```text
discovered → validated → installed → enabled → activated
                                │          │          │
                                └ disabled ◄──────────┘
                                   │
                                uninstalled
```

- `installed` 不代表获得任何权限；
- `enabled` 按场景保存；
- `activated` 是按应用窗口/后台运行器的临时状态；
- 更新先安装新版本并迁移，再原子切换；失败回滚旧版本；
- 禁用立即撤销命令、View 和 Pi Tool 注册，并取消仍在执行的调用；
- 卸载默认保留数据，用户可单独选择删除数据；密钥必须单独确认。

## 兼容性原则

- `schemaVersion` 只描述 Manifest 结构；
- `engines.pluginApi` 使用 SemVer 范围；
- Host API 只增加可选字段，不改变既有字段语义；
- 未识别的必需权限、贡献类型或 API 主版本导致安装失败；
- 插件数据迁移必须幂等，并保留旧版本备份直到新版本首次成功激活。
