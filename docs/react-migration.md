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
- [ ] 后续按依赖度迁移：聊天 Composer → 会话侧栏，随后移除手写 DOM 桥接
- [ ] 迁移完所有模块后，可移除手写 DOM 桥接与旧文件
