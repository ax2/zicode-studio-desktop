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
- [ ] 迁移完所有模块后，可移除手写 DOM 桥接与旧文件
