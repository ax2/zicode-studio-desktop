# ZiCode Studio 前端 React 化迁移手册

目标：把手写 DOM 前端**逐步**改造成 React，采用最优方案，避免二次改造。

## 技术栈（已定，避免返工）

- **React 19 + esbuild（产物构建）+ vitest（测试）**
- **Zustand**：跨组件/跨模块共享状态的官方路线（5.x，1KB）
- **TypeScript（strict）**：`frontend/tsconfig.json`，`bun run typecheck`
- **import map + 共享 vendor 包**：React 只打包一次，所有迁移模块复用
- **CSS**：继续使用现有全局设计令牌与类名，不引入 CSS-in-JS
- **i18n**：复用 `public/i18n.js`（`frontend/src/shared/i18n.ts` 再导出），
  不引入第二套翻译体系

## 目录结构

```text
frontend/
  tsconfig.json
  src/
    vendor.ts                    # React 共享包（import map 指向）
    shared/i18n.ts               # 复用现有 i18n
    features/<name>/             # 每个迁移模块
      index.ts                   # 工厂 + 兼容旧 setup 契约
      <Name>App.tsx              # React 组件
      store.ts                   # Zustand store
      logic.ts                   # 纯函数
      <name>.test.tsx            # vitest + testing-library
public/native/react/             # 构建产物（vendor.js + <name>.js）
scripts/build-react.js           # esbuild 双段构建
```

## 构建

```bash
bun run build:react   # esbuild: vendor（含 React） + 各 feature（外部化 React）
bun run typecheck     # tsc --noEmit
bun run test          # vitest（public/** + frontend/src/**）
```

产物写入 `public/native/react/`，沿用"public 直出"的部署模型
（Tauri 内嵌 + 宿主服务器 + 中继/手机 PWA 均不变）。
`index.html` 的 import map 把 `react`/`react-dom`/`react/jsx-runtime`
映射到 `vendor.js`。

## 迁移一个模块的步骤

1. 在 `frontend/src/features/<name>/` 写 React 实现：
   - `logic.ts` 纯函数（原样搬移，含测试）；
   - `store.ts` Zustand store（动作保持与旧实现相同语义）；
   - `<Name>App.tsx` 组件（类名沿用现有 CSS）；
   - `index.ts` 导出 `setup<Name>App(options)`（返回
     `renderNavigation/renderContent/destroy/...`，与旧契约一致）与逻辑函数。
2. 把 `public/native/plugins/<name>-app.js` 改成薄桥接：
   `import { setup<Name>App, ... } from "../react/<name>.js"; export {...};`
3. `scripts/build-react.js` 的 entry 增加 `<name>`。
4. 测试：新增 `<name>.test.tsx`（logic + 组件 + store），删除旧 DOM 测试。
5. 验证：`build:react`、`typecheck`、`test`、`check`；
   真机/桌面 CDP 实测渲染。

## 注意事项

- **vendor.ts 必须显式具名再导出**（`export *` 经 esbuild 压缩会丢导出），
  且要包含 `export { default } from "react"`（zustand 等库用默认导入）。
- 每个 feature 外部化 `react/react-dom/react-dom/client/react/jsx-runtime`，
  由 import map 解析到共享 vendor。
- i18n 覆盖测试会扫描 `frontend/src`，新增 `t()` key 必须进 zhCN 字典。
- `public/native/react` 是构建产物：biome 已排除；不要手改。

## 路线图

- [x] 基座（构建管线、vendor、import map、类型、测试、i18n 覆盖）
- [x] 试点：自动化中心（`com.zicode.automation`）
- [x] 任务中心（`com.zicode.tasks`）
- [x] 产物（`com.zicode.artifacts`）
- [x] 项目工作台（`com.zicode.projects`）
- [x] 帮助中心（`com.zicode.help`）
- [x] 设置（第 184 轮：面板外壳、导航、通用 tab、外观/版本、hash 路由、
  嵌入式渲染；配置/远程访问/用量/扩展子面板保持 vanilla，由 React 外壳
  在每次挂载时重新接线，后续逐个迁移为纯 React）
- [x] 设置 → 配置 tab（第 185 轮：API keys 面板、provider 通道 CRUD、
  内联 agent-config/models 编辑器全部 React 化，删除 vanilla
  settings-config.js）
- [x] 设置 → 远程访问 tab（第 186 轮：secure mobile access 开关、
  公网/中继/TURN 配置、设备吊销两步确认全部 React 化，删除 vanilla
  remote-access-settings.js）
- [x] 设置 → 用量 tab（第 187 轮：cost-dashboard 加载器 + 渲染器
  965 行整体 React 化：统计卡、365 日活动热力图、Chart.js 模型/项目/
  工具图、会话表、范围切换；删除 vanilla cost-dashboard.js 与
  cost-dashboard-render.js）
- [x] 设置 → 扩展 tab（第 188 轮：package-browse 394 行整体 React 化：
  目录分页抓取、类型/搜索/已安装过滤、排序、安装/卸载、外链；
  删除 vanilla package-browse.js）
- [x] **设置模块全部 React 化完成**（第 184-188 轮）
- [x] 设置通用小部件（第 189 轮：toggles/thinking-effort/scene-profiles
  全部 React 化，删除 vanilla settings-toggles.js / thinking-effort-control.js
  / scene-profiles.js / settings-save-status.js；scene-profiles 保留
  React bundle 再导出 shim 供 workspace-actions / scene-indicator）
- [x] 笔记模块（第 190 轮：notes-app.js 1829 行整体 React 化——
  notesLogic/notesStore/NotesApp/工厂四件套：嵌套笔记本树、笔记拖拽、
  emoji 图标选择、标签、Markdown 编辑/预览、自动保存、附件、捕获/
  导入导出/备份/重建/Astro 发布、移动弹层；删除 vanilla notes-app.js
  与 22 个旧测试）
- [x] 聊天消息渲染（第 191 轮：message-renderer.js 780 行 +
  tool-card.js 456 行合并为一个 React feed——消息/工具卡片按调用顺序
  交错渲染、流式更新/收尾、thinking 块、用量、复制/存笔记/分享/分叉、
  模型错误卡、搜索高亮、历史折叠通知；`MessageRenderer`/`ToolCardRenderer`
  类契约原样保留，app.js 仅两处直接 append 改为 feed 调用）
- [x] 聊天 Composer 模型下拉（第 192 轮：app.js 内约 200 行的模型下拉
  渲染（列表/搜索/空态/加载/错误/最低成本推荐）整体迁入
  `frontend/src/features/composer/modelDropdown.tsx` 的 React 组件 +
  feed（flushSync 渲染 + `getState` 快照 + 选择/设置/重试/关闭回调）；
  app.js 保留数据与开合逻辑，删除 vanilla 渲染函数）
- [x] 聊天 Composer 外壳（第 193 轮：index.html 约 220 行静态 composer
  DOM 整体移除，`setupComposer()` 以 React 渲染外壳（输入框/工具栏/
  发送/中止/思考标签/模型下拉/斜杠菜单/图片预览/排队消息容器，全部 ID
  保留）并返回元素引用；app.js 元素引用改为从 setupComposer 获取，
  斜杠/提交/图片/排队等 vanilla 子模块按 ID 挂进 React 容器继续工作；
  顺带修复 RpivTodoMirrorPanel 对 input-area 直接子节点的依赖）
- [x] 聊天 Composer 提交处理与排队消息（第 194 轮：`ComposerApp.tsx`
  改为有状态组件，Zustand ComposerStore（queue + setQueue），提交处理
  内嵌（Enter/Shift+Enter/IME 守卫/altKey 透传），排队消息列表由 React
  渲染；`setupComposer({ onSubmit })` 返回 ComposerHandle（setQueue/
  dispose）；app.js 删除 composer-submit/queued-messages 导入与渲染
  调用；删除 vanilla composer-submit.js / queued-messages.js 及旧测试；
  原 slash-menu 与提交处理的交互测试改写为 React 集成测试）
- [x] 聊天 Composer 斜杠菜单（第 195 轮：`slashMenu.ts` 纯逻辑 +
  ComposerStore 扩展 slash 状态（open/query/matches/selectedIndex/
  getCommands），`ComposerApp` 以 React 渲染菜单 listbox 并统一处理
  onInput/onClick/onKeyDown/onBlur（打开/过滤/方向键/Enter/Tab 选择/
  Escape 关闭，ARIA 完整）；`setupComposerSlashMenu` 变薄桥接注入
  getCommands 并返回操作 React 状态的 {close, update, openAll}；
  composer-slash-menu.js 变 re-export 桥接；顺带修复 app.js 重复调用
  setupComposer() 的 round 193 遗留）
- [x] 聊天 Composer 图片附件与移动端选择器（第 196 轮：`imageLogic.ts`
  （defaultProcessImageFile/filterImageFiles）+ ComposerStore 扩展
  images/imageKeys/imageBusy/imagePickerOpen/pickerActions；`ComposerApp`
  以 React 渲染图片预览（缩略图/删除/busy 状态）与移动端底部选择面板
  （createPortal 到 body、焦点管理、Escape/Tab 处理、i18n 随
  zicode:locale-changed 刷新）；`setupComposerImageAttachments` 变薄桥接
  （store 单一数据源 + onChange 订阅 + 粘贴/拖放/选择器接线），
  `setupComposerImagePicker` 由 React 状态驱动（移动/桌面分流、历史层、
  相机/相册 input）；composer-images.js / composer-image-picker.js 变
  re-export 桥接；vendor.ts 补 `createPortal` 再导出）
- [x] 会话侧栏（第 197 轮：session-sidebar.js 1031 行整体 React 化——
  `sessionSidebarLogic.ts` 纯逻辑（storage/缓存/分组/状态判定/
  formatSessionTime/高亮）+ Zustand SidebarStore + `SessionSidebarApp`
  React 组件（收藏/当前项目/其他项目/归档/Agent Inbox 固定分组、搜索
  结果与过滤、重命名输入、右键菜单、删除确认、roving tabindex 与键盘
  导航、portal 渲染菜单/覆盖层）+ `SessionSidebar` 类保留旧公开契约
  （load/upsertSession/setActive/markUnread/markRead/setStreaming/
  clearStreaming/toggleFavourite/toggleArchived/archiveProject/
  deleteAllArchived/setSearchQuery/render/dispose），store 变更经
  flushSync 同步提交，原 25 条 DOM 测试原样保留并全部通过；
  session-sidebar.js 变 re-export 桥接）
- [x] 会话搜索对话框（第 198 轮：session-search-dialog.js 307 行整体
  React 化——`sessionSearchDialogLogic.ts` 纯逻辑（Ctrl+K 判定/归一化/
  标题与消息行构建/高亮复用）+ Zustand store + `SessionSearchDialogApp`
  React 组件（overlay+dialog+受控输入+分组结果+空/加载态+方向键/Enter/
  Escape+Tab 焦点环），`setupSessionSearchDialog` 保留旧契约（open/
  close、trigger 接线、文档级 Ctrl+K/Escape、防抖全文搜索、
  locale-changed）；index.html 移除静态 overlay/dialog 改挂
  `#session-search-dialog-root`；session-search-dialog.js 变 re-export
  桥接；踩坑：受控输入用 onChange 对合成 input 事件不触发（真实输入
  也受影响）改 onInput；对话框直接渲染进 React root 而非 portal）
- [x] 财务工作台（第 199 轮：finance-workbench.js 884 行整体 React 化
  ——`financeWorkbenchLogic.ts`（percent/number/样本数据/视图定义）+
  Zustand store（activeViewId/sceneId/status/各视图结果/busy）+
  `FinanceNavApp`/`FinanceContentApp`（场景守卫、7 个视图的表单与结果
  渲染、JSON 表单组件、指标网格、研究卡片、纸面账户）；`setupFinanceWorkbench`
  保留旧插件契约（renderNavigation/renderContent/setTarget/selectView/
  openPanel/loadStatus/destroy），gateway 调用与产物归档不变；
  finance-workbench.js 变 re-export 桥接；静态 `#finance-workbench`
  面板暂留死代码待收尾阶段清理）
- [x] 插件外壳活动栏 + 移动端 More 菜单（第 200 轮：`pluginShellStore.ts`
  + `PluginActivityBarApp.tsx`（品牌/插件活动/系统项/徽标/More 菜单与
  焦点环/19 个图标集），`setupPluginActivityBar` 工厂挂载 React root 并
  提供 commit/getBar；plugin-shell.js 控制器保留全部编排（activate/
  表面切换/历史/移动菜单开关/徽标/注册表订阅），renderActivities/
  updateActivitySelection/移动菜单开关改为 store 提交，DOM 契约
  （data-plugin-id/data-mobile-activity-more 等）原样保留；删除
  buildActivityBar/activityButton/mobileActivityMenuButton 三个 vanilla
  构建器）
- [x] 插件外壳侧栏/主视图外壳内容（第 201 轮：`PluginSidebarShell`
  （标题 + 手风琴：插件管理器过滤快捷项/平台说明/插件 sidebarViews）
  + `PluginMainShell`（hero/overview 卡片/预览状态/金融操作按钮），
  `setupPluginShellSurfaces` 工厂；renderSidebar/renderMain 改为 React
  挂载 + 原委托（settings/help/application/pluginViewHost/manager）不变；
  删除 accordionView/pluginOverview/elementText 三个 vanilla 构建器；
  顺带架构修复：React bundle 内嵌 i18n 副本的 activeLocale 在模块加载时
  冻结，导致 bundle 渲染文本不跟随应用语言（测试 setLocale 后不同步、
  生产运行切换语言漏更新）——`t()` 改为每次读取持久化 cookie，一处修复
  所有 bundle 并支持运行时语言切换）
- [x] Pi 任务进度镜像面板（第 202 轮：rpiv-todo-mirror.js 221 行整体
  React 化——`rpivTodoLogic.ts` 纯逻辑（快照判定/回放/任务筛选/状态
  字形）+ `RpivTodoMirrorApp` 组件（任务列表/折叠头/计数/更多行/语言
  实时切换）+ `RpivTodoMirrorPanel` 类保留旧契约（hydrateFromMessages/
  applyToolResult/setState/clear/expand/dispose）；原 6 条 DOM 测试保留
  经桥接通过（补充 dispose 测试卫生、语言变更断言改异步等待 React
  提交）；rpiv-todo-mirror.js 变 re-export 桥接）
- [x] 头部"在应用中打开"控件（第 203 轮：header-open-app.js 126 行整体
  React 化——`headerOpenAppLogic.ts`（应用图标/字母徽标映射）+
  `HeaderOpenApp` 组件（拆分按钮、logo、应用菜单）+ `setupHeaderOpenApp`
  保留旧契约（工作区信息+已装应用拉取、选择持久化、openInApp 调用、
  document 点击关菜单）；原 2 条测试保留经桥接通过；header-open-app.js
  变 re-export 桥接；注：该控件当前未接入 app.js/index.html，为独立
  遗留模块）
- [x] 原生文件浏览器（第 204 轮：file-browser.js 197 行整体 React 化
  ——`fileBrowserLogic.ts`（按扩展名/类型映射 emoji 图标、字节格式化）+
  `FileBrowserApp` 组件（加载/错误/空态/文件列表，目录行点击进入）+
  `NativeFileBrowser` 类保留旧契约（load 带乱序响应守卫、getParentPath、
  currentPath、路径面包屑与 onPathChange）；原 4 条测试保留经桥接通过；
  file-browser.js 变 re-export 桥接）
- [x] LAN 二维码模态框（第 205 轮：lan-qr.js 214 行整体 React 化
  ——`lanQrLogic.ts`（过期倒计时文案/CA 指纹分组/提示与 alt key）+ 
  `LanQrModalApp` 组件（回环模态框、会话/证书设置双 tab、加载/错误态、
  二维码图、提示/地址/元数据、刷新/打开链接按钮）+ `setupLanQr` 保留
  旧契约（open/close/定时刷新/Escape 与 Tab 焦点环/locale 重渲染）+
  `refreshLanQrButton`（回环检查 + /health）；原 5 条测试保留经桥接
  通过；lan-qr.js 变 re-export 桥接）
- [x] 移动端体验（第 206 轮：mobile-experience.js 290 行整体 React 化
  ——`mobileExperienceLogic.ts`（isIosDevice/canUseRemotePwa/isStandalone）
  + `MobileExperienceApp` 组件（连接状态横幅：离线/重连/停滞/已连接 +
   P2P 直连徽标 + 重试按钮；安装卡片：标题/提示/安装/稍后）+ 
   `setupMobileExperience` 保留全部编排（连接/P2P 监听、重连升级定时器、
  前后台与 BFCache 恢复、beforeinstallprompt/appinstalled、安装推迟
  策略、子模块接线：任务通知/Service Worker/存储持久化/启动路由）；
  原 12 条测试保留经桥接通过；mobile-experience.js 变 re-export 桥接）
- [x] 原生扩展对话框（第 207 轮：dialog.js 191 行整体 React 化
  ——`dialogLogic.ts`（标题/头部徽标/正文/预览块解析、编号选项解析、
  默认标题）+ `NativeDialogApp` 组件（select 选项列表+预览/confirm 确认
  /input-editor 输入，标题/消息/选项/输入与操作按钮，DOM 结构与 vanilla
  一致）+ `showNativeDialog` 保留 Promise 契约（初始聚焦、Escape 取消、
  Ctrl/Cmd+Enter 提交、Tab 焦点环、超时与 dismissSignal、关闭后焦点
  恢复）；原 5 条测试保留经桥接通过；dialog.js 变 re-export 桥接）
- [x] 聊天内联扩展提示（第 208 轮：inline-extension-prompt.js 312 行
  整体 React 化——`inlineExtensionPromptLogic.ts`（请求识别：select
  编号选项/input 多选提示/自定义回答、正文选项解析、type-something 与
  自定义回答判定）+ `InlineExtensionPromptCard` 组件（头部徽标/标题、
  select 选项+悬停预览+type-something 自定义面板、多选复选框+自定义
  输入、input 输入框、Cancel/Submit/Back、answered 状态与 stale 点击
  防护）+ `showInlineExtensionPrompt` 保留 Promise 契约（welcome 移除、
  时间线滚动、dismissSignal 取消、自定义回答队列自动应答）；原 6 条
  测试保留经桥接通过；inline-extension-prompt.js 变 re-export 桥接）
- [x] 插件管理器视图（第 209 轮：plugin-manager-view.js 313 行整体
  React 化——`pluginManagerLogic.ts`（按 origin/启用过滤、过滤定义）+
  `PluginManagerViewApp` 组件（hero/场景、安装本地/签名包/刷新操作、
  5 个过滤 tab、插件卡（图标/名称/来源/描述、启用开关、卸载、回滚、
  吊销、场景权限开关）、诊断面板）+ `renderPluginManagerView` 保留旧
  契约（confirm 注入、onFilterChange、registry 回调）；挂载进独立
  wrapper 避免 plugin-shell 清容器后 React 无法卸载（修复 32 个
  NotFoundError）；原 8 条测试保留经桥接通过；plugin-manager-view.js
  变 re-export 桥接）
- [x] 启动失败界面（第 210 轮：startup-failure.js 96 行整体 React 化
  ——`startupFailureLogic.ts`（错误码文案：配对/撤销/限流/桌面离线/通用）
  + `StartupFailureApp` 组件（role=alertdialog/标题/消息/指引/重试按钮/
  Tab 焦点锁定、t() 本地化）+ `renderStartupFailure` 保留旧契约（先
  unmount 旧根再移除 wrapper、body inert、wrapper 挂载、返回
  [data-startup-failure]）；原 3 条测试保留经桥接通过；startup-failure.js
  变 re-export 桥接）
- [x] 通知中心 + 命令面板（第 211 轮：notification-center.js 64 行与
  command-palette.js 73 行整体 React 化——`notificationCenterLogic.ts`
  （normalizeNotification）+ `NotificationStackApp`（native-notification-
  stack aria-live 栈、error→role=alert 卡片、关闭按钮、自动消失）+
  `createNotificationCenter` 保留旧契约（{notify} 返回 {element,dismiss}、
  duration 定时、flushSync 同步提交）；`commandPaletteLogic.ts`
  （PaletteCommand/resolveCommands）+ `CommandPaletteApp`（command-item
  图标/标签/描述/disabled）+ `setupCommandPalette` 保留旧契约
  （open/close/runCommand、Escape 恢复焦点、Tab 焦点环、overlay 关闭）；
  原 4 条测试保留经桥接通过 + 新增 4 条 React 测试；两文件变 re-export
  桥接）
- [x] 场景指示器 + 项目头部 pills（第 212 轮：scene-indicator.js 70 行与
  project-header.js 41 行整体 React 化——`sceneIndicatorLogic.ts`
  （resolveActiveProfile/toWelcomeScene）+ `SceneIndicatorApp`（点/前缀/
  名称强标签）+ `setupSceneIndicator` 保留旧契约（load/render/setTarget、
  invoke 拉取场景、locale 监听、点击开设置并滚动）；欢迎卡场景数据收进
  ChatFeed（welcome item 携带 scene、`setWelcomeScene`/
  `onOpenSceneSettings` 经 MessageRenderer 注入，去掉 vanilla 直改 React
  DOM 的耦合；无回调时保留旧 DOM 契约供原测试）；`PillText` 组件 +
  `setupProjectHeader` 保留异步契约（路径/git 分支 pill、hidden 态、
  data.workspaceInfo）；原 3 条测试保留经桥接通过 + 新增 5 条 React/feed
  测试；两文件变 re-export 桥接）
- [x] 范围决策（第 212 轮评估）：`plugin-view-host.js`（330 行 iframe/
  对象宿主，DOM 面仅空态/加载/错误壳，核心是 postMessage 路由、能力调用
  与生命周期）与 `extension-ui-host.js`（170 行纯编排）保持 vanilla——
  React 迁移只针对 DOM 渲染部分，iframe 沙箱宿主与编排层不属于 UI 渲染，
  强制 React 化只会增加间接层
- [x] 历史窗口通知收进 React feed（第 213 轮：history-window.js 86 行
  整体 React 化——`historyWindowLogic.ts`（createHistoryWindow 纯逻辑：
  批次窗口/逐轮展开/搜索全量揭示）+ `HistoryWindowNotices`（history-window
  aside+加载按钮、history-loaded 状态）+ ChatFeed 新增
  appendHistoryWindowNotice/appendHistoryLoadedStatus 类型化条目与
  onRevealHistory 注入，app.js 改用 feed 方法，去掉外部 DOM 元素塞入
  feed 的最后一条路径；`createHistoryWindowNotice`/`createHistoryLoadedStatus`
  保留为 React 渲染的兼容工厂（根建在元素自身，节点移动后事件不失效）；
  原 5 条测试保留经桥接通过 + 新增 1 条 feed 测试；history-window.js 变
  re-export 桥接）
- [x] 最终清理第一步（第 214 轮）：index.html 移除 529 行死静态代码——
  #finance-workbench 整块（约 393 行，React 插件容器接管）、#lan-qr-modal
  内部静态内容（约 110 行，React 模态框接管，保留容器与 role/aria 属性）、
  #messages 静态欢迎区（约 32 行，ChatFeed 渲染欢迎卡）；删除前后
  div/aside 配平差值与原始一致（49/49 成对移除），布局契约测试 46 条
  原样通过，687 测试全绿
- [x] 最终清理第二步（第 215 轮）：移除全部手写 DOM 桥接——28 个纯
  re-export 桥接文件删除（composer-* 3、extensions 3、features 7、
  notifications 1、plugins 6、session 3、settings 2、workspace 3）；
  app.js / bootstrap-entry / plugin-shell / workspace-actions 与 17 个
  测试文件的导入全部改为直接指向 public/native/react/*.js 产物；
  plugin-shell.js（815 行真实编排模块）保留并仅改其 plugin-manager-view
  导入；全仓无残留引用，687 测试全绿；剩余 vanilla 文件均为非 UI 逻辑/
  编排/宿主模块，按第 212 轮范围决策保留
- [x] 最终清理第三步（第 216 轮）：死代码清扫——删除 session-tree.js
  （SessionTreeController 仅测试引用、无生产消费者，随测试一并移除）；
  index.html 再清两处被 React 取代的静态内容（#session-list 内
  session-loading、#scene-indicator 按钮内部 spans）；连带修正
  setupSceneIndicator 挂载前对 #scene-indicator-name 的存在性检查
  （静态元素删除后改为只要求容器，名称由 React 渲染）；全量 685 测试
  全绿（687→685，随 session-tree 测试删除）
- [x] 上下文用量胶囊与弹层（第 217 轮：context-usage.js 100 行 +
  ui/context-viz.js 88 行整体 React 化——`contextUsageLogic.ts`
  （formatTokens/usageTotal/findLatestAssistantUsage/normalizeUsage/
  computeContextViz）+ `TokenUsagePill`/`ContextVizApp` 组件（pill 文本、
  context-bar 分段、legend、used/total）+ `setupContextUsage` 保留旧契约
  （setUsage/setContextWindowSize/clear/usage 读写、点击切换与外部点击
  关闭）；保留 #token-usage/#context-viz/#context-bar/#context-legend id
  契约；原 2 条测试保留经桥接通过 + 新增 2 条 React 测试；旧文件与
  ui/context-viz.js 删除）
- [x] 应用更新器收进 React 设置（第 218 轮：app-updater.js 154 行删除
  ——状态机移入 `settings/updaterStore.ts`（zustand store：configure/
  checkNow/installUpdate/下载进度/静默定时/频道切换），设置面板更新行
  改为从 store 渲染（status/button/disabled/data-mode/aria-busy，beta
  行随 enabled 隐藏），消除 vanilla 直改 React DOM 的最后一处耦合；
  `setupAppUpdater` 保留旧契约（enabled 模式接线侧栏按钮、原始 DOM
  同步、静默检查；disabled 模式不触发检查），app.js 改从
  react/settings.js 导入；原 2 条测试保留经构建产物通过 + 新增 2 条
  store 测试；调试中揪出并修复 Tauri 全局读取路径 bug（误把
  globalThis 当 __TAURI__ 本体，改为 globalThis.__TAURI__?.updater?.check）
- [x] 对话导航轨道（第 219 轮：ui/conv-nav.js 334 行 React 化——
  `convNavLogic.ts`（tooltip 预览/gaussianWidth/scrollBehavior/
  MAX_NAV_HEIGHT）+ `ConvNavTrack`/`ConvNavTooltip` 组件（每轮一个圆点
  按钮：active 态、aria-label、悬停 --nav-w 高斯波、点击跳转；提示
  q/a 内容与分隔线）+ `ConvNav` 类保留全部契约（mount/rebuild/
  notifyNewMessage/notifyStreamingStart/destroy；滚动测量、
  MutationObserver、badge、live-status、焦点、高亮、锁定与缩放编排
  留在控制器）；原 8 条测试保留经构建产物通过 + 新增 3 条 React 测试；
  conv-nav.js 删除、导入指向 react 产物）
- [x] 移动端"稍后发送"横幅（第 220 轮：mobile-send-later.js 168 行
  React 化——`MobileSendLaterBanner` 组件（aria-live aside：标题/消息/
  "立即发送"/"保留为草稿"按钮、hidden 随 active、按钮随 connected/busy
  禁用）+ `setupMobileSendLater` 保留旧契约（dispose/isConnected/
  queueCurrent/restoreCurrent/sent/setTarget，断线队列、连接恢复、
  locale 重渲染、发送按钮标签同步）；原 3 条测试保留经构建产物通过 +
  新增 2 条 React 测试；旧文件删除、导入指向 react 产物）
- [x] 移动端任务通知设置并入 React（第 221 轮：mobile-task-notifications.js
  176 行删除——UI 状态移入 `settings/taskNotificationsStore.ts`
  （全局单例 zustand store，跨 settings/mobile-experience 两个 bundle
  共享同一实例：hidden/enabled/requesting/supported/permission/statusKey
  + configure/refresh/setEnabled 权限流程），设置面板 GeneralTab 移动
  任务行改为从 store 渲染（section 显隐、toggle on/aria-checked/disabled/
  aria-busy/onClick、状态文案），消除 vanilla 改 React 设置行的耦合；
  `setupMobileTaskNotifications` 控制器保留契约（handleRuntimeEvent/
  setTaskRunning/isEnabled/setEnabled/dispose + 通知触发逻辑），
  desktop 仍返回 null；原 6 条测试保留经构建产物通过 + 新增 2 条 store
  测试；旧文件删除、测试导入指向 react 产物）
- [x] 移动端草稿存储保护设置并入 React（第 222 轮：
  mobile-storage-persistence.js 135 行删除——UI 状态移入
  `settings/storagePersistenceStore.ts`（全局单例 zustand store：
  hidden/state/requesting/supported/estimate/buttonKey/buttonDisabled/
  statusText + configure/refresh/requestProtection，estimate 显式状态
  字段），设置面板草稿存储行改为从 store 渲染（行显隐、按钮文案/禁用/
  aria-busy/onClick、状态文案），消除最后一处 vanilla 改 React 设置行
  耦合；`setupMobileStoragePersistence` 控制器保留契约（refresh/
  requestProtection/dispose + visibilitychange/locale 监听），desktop
  返回 null；原 5 条测试保留经构建产物通过 + 新增 2 条 store 测试；
  旧文件删除、测试导入指向 react 产物）
- [x] 迁移完成审计（第 223 轮）：补删最后两个漏网桥接
  （ui/message-renderer.js、ui/tool-card.js → app.js 直连 react/chat.js）；
  全量盘点剩余 vanilla 文件并分类：web 组件（chat-settings-panel /
  sa-chat-header / super-agent-*，独立组件架构）、壳编排（app.js /
  plugin-shell / plugin-view-host / sidebar-toggle / layout-insets /
  resizable-panel / keyboard-shortcuts / router）、React 工具助手
  （markdown / image-lightbox / themes / i18n）、独立页面（offline /
  install-status）、纯逻辑（transport / gateways / model-routing /
  session-* / workspace-actions / remote-auth / mobile-* /
  extension-ui-host / slash-commands / super-agent 逻辑）——均按第 212
  轮范围决策保持 vanilla；React 迁移主线完成：28 个 DOM 渲染模块全部
  React 化、手写 DOM 桥接与死代码清零、698 测试全绿
- [x] UI 布局修复走查（第 224 轮）：对话区空隙（.app-side-panel 在列
  布局里 in-flow 占高）→ 右侧栏绝对定位右轨 + 折叠离屏；活动栏全高
  沉底；help 独立 wrapper 挂载修复空白；主题 select 受控值同步；
  body 横向溢出裁剪；任务中心核实为诚实空态；CDP 实测 9+ 视图全高
  零异常，698 测试全绿
- [x] 笔记闪动修复（第 225 轮）：受控 details 与 onToggle 反馈循环 →
  用户意图优先同步（force 参数）+ 选中主动展开一次、可收起；新增
  回归测试，真实实例 CDP 验证；项目/任务/自动化空态经配置网关直调
  核实为数据本身为空（前端加载正常）；699 测试全绿
- [x] 笔记导航修正（第 226 轮）：summary 阻止默认行为、完全受控展开
  （真实点击可展开/收起）；编辑态自动展开；plugin-shell 有自主导航的
  应用不再渲染通用 accordion（消除顶部空重复区块与按钮遮挡）；
  `.notes-nav-button` 补入共享按钮样式（标签恢复竖排）；699 测试全绿
- [x] 项目贯穿 P1（第 233 轮）：notesStore 增加项目上下文
  （`ProjectInfo` + `project` 状态 + `setProject`），笔记侧栏顶部渲染
  项目头部；plugin-shell 侧栏壳新增项目行（`getProject` 注入 +
  `refreshSidebar`）；会话侧栏当前项目分组新增笔记/产物/任务快捷按钮；
  app.js 维护 `currentProjectInfo`（adoptTarget 切 workspace 时经
  workspaceInfo 解析并同步 notes/plugin-shell）；typecheck + 703 测试
  全绿，CDP 实测无重叠无溢出
- [x] 项目贯穿 P2（第 234 轮）：notes/artifacts 网关与 store 全面双键
  （sceneId + workspaceId，getTarget 提供 workspaceId），projects 聚合
  与 finance 产物写入同步适配；Rust 后端 workspace 目录归属 + 迁移 +
  能力作用域，前端 703 + Rust 163 测试全绿
- [x] 项目贯穿 P3（第 235 轮）：项目工作台概览新增任务/自动化统计卡；
  搜索结果行按钮化 + 深链事件（open-note/open-artifact/open-session）
  与 notes/artifacts handle openNote/openArtifact；760px 以下移动端
  单列堆叠；前端 706 测试全绿
- [x] 生产可用性走查（第 236 轮）：项目工作台"最近项目成果"行可点击
  深链；笔记快速访问"最近笔记"改为 store 全局缓存（不再随标签/查询
  筛选消失）；全视图审计无控制台错误/溢出；前端 708 测试全绿
- [x] 笔记拖拽改进（第 237 轮）：drop 落点从标题行扩展到整个笔记本
  分支（展开区也可投放），drop 高亮覆盖整个分支；生产版 CDP 指针
  模拟实测双向拖拽成功并还原数据
- [x] 命令面板快捷键（第 238 轮）：Ctrl/Cmd+K 与 Ctrl/Cmd+Shift+P 打开
  命令面板，命令面板纳入 overlayOwnsEscape；前端 710 测试全绿
- [x] i18n 单一实例化（第 239 轮）：i18n/themes 经 import map 共享，
  build-react 外部化，React 包与原生端共用同一语言状态；修复语言切换
  时原生 MutationObserver 用旧 locale 回译导致的"cookie=en 仍显示
  中文"；vitest 别名 + ambient 类型声明
- [x] 笔记数据管理默认实现（第 240 轮）：notesStore 补齐真实
  defaultDownloadFile/defaultChooseFile，修复导出/导入/附件的桌面端
  空操作；导出端到端验证下载有效备份文件
- [x] 命令面板搜索（第 241 轮）：搜索输入 + 即时过滤 + 方向键/Enter
  导航 + 选中高亮 + 空态；修正"先显示再聚焦"顺序；空操作默认值全
  前端扫描确认干净，补导入备份单测；前端 713 测试全绿
- [x] 成本面板重试（第 242 轮）：用量错误态补"重试"按钮（onRetry
  重新加载）；自动化创建→列表→删除全流程生产版实测通过
- [x] 成本面板 i18n（第 243 轮）：统计卡/章节/表头/活动面板 30+ 处
  文案接入 t()，补 17 个翻译 key；用量页生产版实测全中文
- [x] i18n 残留清扫（第 244 轮）：全前端扫描补齐 7 个缺翻译 key
  （斜杠空态/预览/提供商/用量空态），复核任务/金融/帮助等标签 key
  齐全；斜杠空态生产版实测中文
- [x] 数据审计与上下文空态（第 245 轮）：笔记重建索引与会话 JSONL
  一致性审计通过；ContextVizApp 无用量时渲染"暂无用量数据"空态
  （防御性），补测试；714 测试全绿
- [x] 快捷键冲突修复（第 246 轮）：命令面板改为 Ctrl+Shift+P，
  Ctrl+K 回归会话搜索独占，消除双浮层冲突；会话管理（收藏/归档/
  重命名/删除）全流程生产版实测通过
- [x] 模型错误分类补全（第 248 轮）：describeModelError 新增
  context-length 分类（上下文超长提示新建会话/压缩上下文）+ 2 条测试；
  快速切换应用压力测试无泄漏/错误
- [x] 会话侧栏 i18n（第 249 轮）：Show more/Show less/Failed to load
  sessions 接入 t() 并补中文；运行面审计（日志/二维码/中继状态）无
  缺陷
- [x] 静默错误路径审计（第 252 轮）：空 catch 逐项复核均为 best-effort；
  模型渠道旧凭据清理失败补"无法移除旧凭据"警告
- [x] 笔记保存状态（第 253 轮）：编辑器 saveState（dirty/saving/saved）
  与指示 UI + 3 个翻译 key + 流转测试；715 测试全绿
- [x] 命令按钮快捷键提示（第 254 轮）：title 补"命令 (Ctrl+Shift+P)"
- [x] 笔记项目头部跳转（第 260 轮）：项目头部按钮化 + zicode:open-project
  事件接线，点击打开项目工作台；回归测试 + 生产版实测
- [x] 插件壳项目行跳转（第 261 轮）：plugin-sidebar-project 按钮化 +
  中英 title + 测试；设置等应用点击项目行打开项目工作台
- [x] 笔记本删除（第 263 轮）：NotesVault.delete_notebook + /v2 API +
   store 二次确认（级联提示）+ UI 删除图标 + Rust/前端测试；release
   重建并验证
- [x] 桌面宽窗口空白（第 264 轮）：messages/input-area 固定 960px
   改为 --chat-content-max-width 分档变量，应用视图接入
   --app-content-max-width，宽屏不再留大片两侧空白
- [x] 笔记选中文字带入对话（第 264 轮）：textarea 选区实时同步 +
   点击时实时读取 + 用例覆盖
- [x] 笔记/移动端顶部避让（第 265 轮）：notes 内容挂 notes-main 类、
   移动端 plugin-main-view 顶部 padding 提至 68px，修复各应用顶部
   被 header 覆盖
- [x] Files 入口跨应用可达（第 266 轮）：非 Chat 视图点击 Files 先
   切回 Chat 再打开文件面板 + 回归测试
- [x] PWA 分享入口 service-worker 测试（第 267 轮）：multipart
   解析、landing 注入、fetch 路由 4 例 vm 沙箱测试
- [x] release 第十一次重建（第 268 轮）：EXE 41,316,864 B /
   安装包 346,819,246 B，含第 264–267 轮修复，静默重装验证通过
- [x] 插件侧栏 fallback items（第 269 轮）：字符串 items 规范化
   为 {label}，消除空白按钮与 React key 警告 + 回归测试
- [x] PWA share_target 作用域（第 270 轮）：relay 重写 manifest 时把
   share_target.action 一并改为设备作用域路径，service-worker 同时
   匹配 /share-target 与 /d/{device}/app/share-target + 两侧测试
- [x] 桌面宽窗口空间利用（第 271 轮）：桌面欢迎页垂直居中 + 快捷入口
   （开始新对话/项目/笔记/任务/自动化，openApp 逐层透传）+ 消息列
   留白封顶 96px（--chat-gutter-max）+ 默认窗口 1440×900；移动端
   欢迎页保持紧凑；前端 731 测试全绿
- [x] release 第十二次重建（第 272 轮）：EXE 41,316,864 B / 安装包
   346,872,608 B，含第 270–271 轮修复，静默重装验证通过
- [x] 插件应用 React 根失效（第 273 轮）：项目/任务/自动化/产物/金融
   接入共享挂载辅助（wrapper + 重建根，display:contents），修复切换
   应用后视图变空、removeChild 异常与 finance 类污染；前端 734 测试
   全绿，CDP 两轮全应用切换 0 异常
- [x] release 第十三次重建（第 274 轮）：EXE 41,320,960 B / 安装包
   346,828,957 B，含第 273 轮修复，静默重装验证通过
- [x] 移动弹层 Escape 关闭（第 275 轮）：MovePopover 补 keydown Escape
   关闭分支 + 组件测试；并实测跨笔记本双向拖拽、嵌套笔记本创建/级联
   删除全流程；前端 735 测试全绿
- [x] release 第十四次重建（第 276 轮）：EXE 41,320,960 B / 安装包
   346,829,217 B，含第 275 轮修复，静默重装验证通过
- [x] 社区包目录并行加载（第 277 轮）：fetchCatalog 首页取 totalPages 后
   并行拉取剩余页（Promise.all 保持页序），加载从 20–40 秒降到 265ms；
   前端 736 测试全绿
- [x] release 第十五次重建（第 278 轮）：EXE 41,320,960 B / 安装包
   346,820,935 B，含第 277 轮优化，静默重装验证通过
- [x] 设置页 a11y 标签（第 280 轮）：自动压缩/显示思考两个 switch 补
   aria-label，场景下拉补 aria-label + 回归断言；9 视图 a11y 扫描 0 问题
- [x] release 第十六次重建（第 281 轮）：EXE 41,320,960 B / 安装包
   346,803,897 B，含第 280 轮修复，静默重装验证通过
- [x] 命令面板焦点恢复（第 282 轮）：open 记录先前焦点（排除 body），
   close 恢复原位否则回退命令按钮 + 回归测试；前端 737 测试全绿
- [x] release 第十七次重建（第 283 轮）：EXE 41,320,960 B / 安装包
   346,856,567 B，含第 282 轮修复，静默重装验证通过
- [x] 设计 CSS 检查清零（第 284 轮）：session-sidebar 字面量 12px 改
   设计令牌，check-design-css 门禁首次全绿
- [x] release 第十八次重建（第 285 轮）：EXE 41,320,960 B / 安装包
   346,864,649 B，含第 284 轮修复，静默重装验证通过
- [x] 公网中继线上更新（第 286 轮）：服务器 relay 二进制为 8-06 构建、
   缺 round 270 的 share_target.action 重写；本机验证可构建后上传源码
   到服务器重建并替换（保留 systemd 令牌），manifest action 已重写为
   设备作用域、桌面在线、可回滚
- [x] 服务器基础设施实证（第 287 轮）：公网 STUN binding 成功响应
   （turn.remote.zicode.com:3478）、coturn active、中继 5 分钟健康检查
   计时器与每日用量持久化确认
