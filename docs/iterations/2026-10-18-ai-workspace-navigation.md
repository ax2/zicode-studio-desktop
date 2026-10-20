# Stage：AI 模式同窗口工作区导航

日期：2026-10-18。范围仅 Studio，沿用现有 Windows Debug EXE 与隔离 profile；未启用 JSON 对象插件或 Pi 工具权限，未运行模型请求。

## 发现与修改

显式 `--tools-only` 选择工作区打开独立窗口，不能证明 AI 模式的导航。此次在不带 `--tools-only` 的隔离窗口核对 AI 路径。另发现非桌面客户端没有 Tauri 工作区按钮，键盘快捷键会尝试聚焦隐藏控件；现让快捷键、命令面板命令及项目应用入口共用 `openVisibleWorkspaceSwitcher`，无原生切换能力时显示已有的移动网页端指导提示。

## 真实运行环境证据

- 初始为隔离 `system` 工作区的 AI 对话首页，窗口状态“已连接”，未选择模型、未发送消息。
- Ctrl+Shift+O 打开含 `system` 与 `E:\zicode-studio-desktop` 的菜单。选中项目后，同一 Windows 窗口 ID `36245226` 的工作区栏显示项目路径并恢复“已连接”。
- 在该项目窗口按 Ctrl+Shift+P，点击“切换工作区”命令：命令面板关闭，工作区菜单出现。选择 `system` 后，仍在同一窗口 ID `36245226`，隔离路径与“已连接”状态恢复。代表性 1442×931 浅色截图在技术博客同名 Stage 的 `screenshots/`。
- 隔离窗口通过 Alt+F4 关闭；按 EXE 路径、profile 参数和无 `--tools-only` 核对后结束唯一验收进程。未见残留的该 profile 应用或 Pi 子进程。

## 检查与限制

定向布局契约 Vitest 68/68、`bun run check`、`node --check public/native/app.js` 和 `git diff --check` 通过。既有 147 warnings、10 infos 与 1 项设计 warning 保持。无原生工作区切换能力的网页端提示只有源码和布局契约覆盖，**尚未在移动网页端真机验收**。命令面板打开时由外部事件强制变更同一 WebView 目标的自动关闭仍待单独验收；这次命令路径会主动先关闭面板。macOS/Linux、正式签名插件、DevTools 154 项和 ZiFile 108 项全量流程仍待，后两者累计正式接受为 0/154、0/108。

空间预算前后只读扫描：`target` 30,041,815,353 B、非 scratch `.cache` 355,458,670 B、task-scratch 1,412,327,590 B、`site` 29,644,753 B 均未变化，未知项 0；E 盘空闲 144,998,400 → 80,261,120 B，稍后单独读取恢复到 127,451,136 B。该波动未定位到上述项目树或项目 `.zicode` 文件，不归因于某一构建；未删除缓存或测试资料。无新 Debug/Release、ZIP 或版本号变更。
