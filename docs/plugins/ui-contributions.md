# 插件 UI 与导航设计

## 信息架构

桌面布局分成三个稳定区域：

```text
┌────────┬──────────────────┬──────────────────────────────────────┐
│ 导航   │ 功能区           │ 主视图                               │
│Activity│ Sidebar Views    │ Chat / Notes / Finance / ...         │
│        │                  │                                      │
│        │                  │                                      │
└──────────────────────────────────────────────────────────────────┘
```

Activity Bar 是最左侧窄栏；点击图标切换 Activity。与 Cursor/VS Code 相似，但
ZiCode 的第二栏采用可折叠的风琴 View，允许一个插件展示“笔记本”“标签”“最近剪藏”等多个
数据视图。连接状态、审批和文件管理等应用内控件属于当前应用主视图，不构成第四个全局
菜单区。

## Chat 作为核心插件

- Activity ID 为 `core.chat`，固定排序第一；
- 使用现有 Session Sidebar 作为 Chat 的 Sidebar View；
- 现有消息列表、Composer、Context Usage 和右侧文件栏组成 Chat Main View；
- 切换到其他 Main View 时，Chat 容器设置 `hidden`、`inert` 和
  `aria-hidden="true"`，暂停昂贵布局观察器，但不销毁 Session 状态；
- 返回 Chat 时恢复之前的 Session、滚动锚点、草稿和焦点；
- Chat 功能区顶部不重复显示 ZiCode Logo，底部不重复放置 Settings 和 Help；这些入口
  只存在于导航栏；
- 系统通知、审批和 Agent 运行状态不能因为 Chat 不可见而丢失，Activity Badge 显示
  待处理数量。

## Activity Bar

排序规则：

1. `core.chat`；
2. 用户固定的插件；
3. Manifest `order`；
4. 插件显示名称。

底部固定系统入口：

- Plugin Manager；
- Settings；
- Help；
- Account/Update（存在时）。

右键菜单提供“固定/取消固定”“隐藏 Badge”“管理此插件”。内置 Chat 不能隐藏。Activity
超过可用高度时进入可搜索的 Overflow，不使用无限纵向压缩。

## Accordion Sidebar Views

- View Header 包含标题、Badge、折叠按钮和最多三个高频动作；
- 展开状态按 `pluginId + activityId + viewId + workspaceId` 保存；
- 当前插件至少保留一个 View 可见；全部折叠时显示恢复入口；
- View 可声明最小高度，但用户拖动分隔条后的比例优先；
- 插件 iframe 只占用 View Body，Header 和系统菜单由 Shell 绘制；
- 加载、空、错误、权限缺失和插件禁用均有 Host 标准状态。

## Main View Router

路由键为 `{activityId, mainViewId, resource?}`，支持：

- 浏览器前进/后退；
- 应用重启恢复上次 Activity；
- 深链打开具体笔记或股票；
- Command 直接打开 View；
- 插件禁用后回退 `core.chat`；
- 当前 Main View 有未保存内容时调用标准 `canDeactivate`，用户选择保存、丢弃或取消。

同一窗口只挂载一个可交互 Main View。插件不能把浮层覆盖在另一个插件或 Chat 上以模拟
激活状态。

## 命令面板、快捷键与局部动作

应用插件不贡献顶部工具栏或应用菜单。需要全局触达但没有 Activity 的轻量插件使用
Command Palette 和可选快捷键；与具体数据相关的动作放在插件 Sidebar/Main View
内部，或由 Host 在对应资源的上下文动作区域呈现。

Command Palette 在 Activity Bar 系统区保留固定入口，因此切换到没有 Chat Composer
的插件主界面后仍然可达。

规则：

- 所有入口引用 Manifest Command，不重复实现 Handler；
- 插件不能覆盖系统 Command ID；
- 命令面板显示插件名称、权限状态和快捷键；
- 禁用插件的命令不出现；
- 缺少可选权限的命令显示“授权后使用”，不能执行后静默失败；
- 快捷键冲突由 Host 显示并允许用户调整，不按安装顺序静默覆盖；
- 涉及费用、发布、删除、外部上传的动作必须走确认或预览；
- 现有顶部区域只保留会话连接状态、场景和系统窗口等必要控件，不接受插件注入。
- 桌面原生应用菜单栏关闭；新建会话、编辑和窗口操作分别由功能区、标准快捷键和操作
  系统窗口控件承载。

## Settings 与 Help

- Settings 和 Help 都是系统应用，与 Chat、Notes 等使用相同的导航切换；
- Settings 的设置分类放在功能区，当前分类内容放在主视图；
- Help 的文档目录放在功能区，Markdown 正文和页内目录放在主视图；
- 两者都不使用覆盖层、模态弹窗或独立窗口；
- Help 内容按界面语言从 `public/help/` 或 `public/help/en/` 加载；
- 切换应用时保留 Settings 当前分类与 Help 当前页面。

## Plugin Manager

Plugin Manager 是系统 Main View，并在 Activity Bar 底部有固定入口。页面包含：

- Installed、Built-in、Updates、Disabled、Developer 五个筛选；
- 搜索名称、发布者、能力和权限；
- 详情页显示版本、来源、签名、贡献、权限、数据占用和最近错误；
- 启用范围：所有允许场景或逐场景；
- 权限开关及每项授权理由；
- 更新、回滚、禁用、卸载、打开数据目录、导出诊断；
- 开发目录的 Reload、Open DevTools 和 Manifest Validation；
- 无法卸载的核心插件明确说明原因。

卸载操作分三步：

1. 禁用并等待当前调用取消或结束；
2. 删除程序包；
3. 询问是否保留数据与是否删除 Secret Ref。

默认保留数据，防止误删笔记。

## 响应式与无障碍

- `>= 1100px`：Activity + Sidebar + Main 完整显示；
- `720px–1099px`：Sidebar 可覆盖或折叠，Main 保持独占；
- `< 720px`：Activity 变为底部/顶部可滚动 Tab，Sidebar 作为抽屉；
- 所有 Activity、View Header 和 Command 支持键盘和可见焦点；
- 图标必须有可本地化名称，Badge 通过 `aria-label` 描述；
- 插件 iframe 的焦点进入/退出由 SDK 提供快捷键，不制造键盘陷阱；
- Theme Token 通过只读 CSS Variables 注入，插件不能覆盖 Shell Token。
