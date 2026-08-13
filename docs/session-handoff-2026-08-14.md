# ZiCode Studio Desktop 会话交接（2026-08-14）

## 当前状态

- 本轮聚焦「提高程序的可用性」，完成一轮桌面/移动端可用性收口并交付
  release 产物；工作树干净，`main` 与 `origin/main` 同步。
- 桌面实例运行中（安装目录 release 版），`/health` 200、`piVersion 0.84.1`、
  公网中继 `dev-ax2-01` 在线，启动日志无 ERROR/WARN/panic。
- 最终 release 产物：
  - `target/release/zicode-studio-desktop.exe`：45,700,096 B
  - `target/release/bundle/nsis/ZiCode Studio Desktop_0.1.0_x64-setup.exe`：
    347,990,159 B，SHA-256 `D9DF2356…`
- 双门禁全绿：Rust（`bash scripts/check-rust.sh`：206 测试 + clippy
  `-D warnings` + fmt）；前端（`bun run test`：全量 vitest + Tauri 权限 +
  Windows 子进程策略）。

## 本轮完成的可用性改动（已推送）

- 错误文案本地化：工具卡片状态/展开收起标签走 `t()`；工具运行时错误与
  插件运行时断开错误统一映射为友好中文（`friendlyToolError`、
  `hostErrors.ts`）。
- 活动栏：插件溢出滚动淡出提示；`Ctrl/Cmd+1~9` 应用切换快捷键（含帮助
  文档 + tooltip 提示）。
- 金融工作台：修复「打开场景设置」错跳 API Key 配置的问题（改为跳场景
  选择，并补回归测试）。
- 会话侧栏：修复「删除全部已归档」按钮键盘不可达（`display:none` →
  `opacity/visibility` + focus 规则 + `tabIndex`）。
- 项目工作台：降级提示增加内联「重试」入口。

## 回归基建

- 新增 `scripts/visual-qa.mjs`：无头 Chrome + CDP 可视化/交互 QA。
  - 覆盖 18 个视图 × 桌面 1440×900 / 移动 390×844 / 375×667；
  - 交互检查：笔记编辑器（默认预览/编辑切换/标签/工具栏）、自动化表单、
    移动端「更多」菜单、金融研究工作区表单；
  - 用法：`node scripts/visual-qa.mjs <workspaceId> <sessionId>`，可加
    `APP_FILTER`、`VIEWPORT=WxH`、`CDP_PORT` 环境变量。
  - 截图输出到 `docs/screenshots/`（已 gitignore）。
- 金融场景可用 `POST /v2/new-session`（`{workspaceId, sceneId:"finance"}`）
  快速创建，便于端到端验证金融工作台。

## 关键路径与约定

- 项目：`C:\Users\ax2\zicode-studio-desktop`（Rust + Tauri，React/TS 由
  esbuild 打包到 `public/native/react/*.js`）。
- 前端改动后需 `bun run build:react`（会重生成全部 react 包，不要手改产物）；
  设计门禁 `bun run check:design`；typecheck `bun run typecheck`。
- 桌面日志：`%LOCALAPPDATA%\zicode\logs\ZiCode Studio Desktop.log`（UTC）。
- 文档不记录敏感信息（secret/口令只留非敏感描述）。

## 注意：git 推送代理

本地 git 配置的代理 `127.0.0.1:7890` 对 github 偶发 SSL 抖动，系统代理
`127.0.0.1:1080` 稳定。推送失败时用：

```
git -c http.proxy=http://127.0.0.1:1080 -c https.proxy=http://127.0.0.1:1080 push origin main
```

## 遗留与建议

- 未发现新的可自动推进的实质问题；后续建议以用户实际使用中的具体卡点
  定点收口。
- 外部项（与本轮无关）：安装包签名（待 Authenticode 证书）、服务器部署、
  真机跨 NAT 打洞验收。
